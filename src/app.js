// -----------------------------------------------------------------------------
// The integration, both ways:
//   - to Zapier: when a scene reaches "Send to a Zap" (or "Send JSON to a
//     Zap"), or on the "Send a test event" button, one POST to the Catch Hook
//     URL of the Zap chosen. Zapier is called at no other time (no polling,
//     nothing at start, nothing on a configuration change, nothing because an
//     event was received);
//   - from Zapier: a request relayed by Gladys Plus (webhook `inbound`)
//     becomes the `zap_received` scene event. Receiving never sends anything.
//
// Guards, in the order a send meets them:
//   - the fields: a valid event name, values of 1000 characters at most (never
//     cut), a JSON object of 8 KB at most;
//   - one request in flight at a time (a queue of 10 at most, each job with
//     its own deadline: a job whose time is over sends nothing);
//   - a pause after a 429 (Retry-After, bounded 60 s to 6 h) or a 5xx (60 s,
//     doubled on repeat, 6 h at most), kept in /data;
//   - the loop guard: more than LOOP_MAX sends each leaving less than 15 s
//     after an event received from Zapier, within 5 minutes, stop every send
//     for 30 minutes (kept in /data; saving the configuration lifts it);
//   - a hook Zapier does not know (404/410) is never sent to again by a
//     scene: its 8-bit salted fingerprint is kept in /data, lifted by a new URL
//     or a success of the test button;
//   - the caps: Zap runs counted over the last 24 hours and the last 30 days,
//     plus this send (one task per Zap of the hook), must not pass the caps;
//     at most 10 sends per minute. A send is counted and the count SAVED in
//     /data before its request leaves (no save, no request), and given back
//     only when Zapier surely did not take it;
//   - a send that may have been taken (timeout, connection cut, 5xx) is never
//     tried again: a second try could run the Zap twice.
//
// The hook URLs, the inbound secret and the values never reach a log, the
// status nor /data. Clocks: `monotonic` decides (caps, pauses, loop guard,
// deadlines); `now` (wall) only dates /data and the `sent_at` field.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes } from 'node:crypto';
import {
  BUTTON_BUDGET,
  DAY,
  EVENT_NAME,
  LOAD_TIMEOUT,
  LOOP_MAX,
  LOOP_PAUSE,
  LOOP_SPAN,
  LOOP_WINDOW,
  MAX_CALLS_KEPT,
  MAX_INBOUND_PER_MINUTE,
  MAX_JSON_BYTES,
  MAX_PER_MINUTE,
  MAX_QUEUE,
  MAX_VALUE,
  MINUTE,
  MONTH,
  PAUSE_MAX,
  PAUSE_MIN,
  SAVE_TIMEOUT,
  SCENE_BUDGET,
  SCENE_TRIGGERS,
  SEND_MARGIN,
  STATUS_TIMEOUT,
  STORE_RETRY,
  WEBHOOKS,
  WEBHOOKS_TIMEOUT,
  ZAPS,
} from './constants.js';
import { normalizeConfig } from './config.js';
import { ZapierError, postHook } from './http.js';
import { T, join, reasonMessage, sceneError } from './i18n.js';
import { inboundEvent } from './inbound.js';

const realTimers = { setTimeout, clearTimeout };
const CONFIG_RETRY = [5_000, 10_000, 30_000, 60_000, 300_000];
const REQUEST_ID = /^[A-Za-z0-9-]{1,80}$/;
const PAUSE_WHY = ['rate_limited', 'server', 'client', 'loop'];

/** A refused send: nothing left. `code` is a key of T.reason. */
export class NotSent extends Error {
  constructor(code) {
    super(code);
    this.name = 'NotSent';
    this.code = code;
  }
}

/** The 8-bit fingerprint of a hook: enough to recognise it, never to find it back. */
export const hookMark = (salt, url) =>
  createHmac('sha256', salt).update(String(url)).digest('hex').slice(0, 2);

/** A value of a scene field: a string (numbers turned into text), never cut. */
function valueOf(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  if (typeof raw !== 'string') throw new NotSent('too_long');
  if (raw.length > MAX_VALUE) throw new NotSent('too_long');
  return raw;
}

export class App {
  constructor({
    gladys,
    logger = console,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = realTimers,
    store,
    fetchImpl = (...args) => globalThis.fetch(...args),
    random = (n) => randomBytes(n).toString('hex'),
  }) {
    Object.assign(this, { gladys, logger, now, monotonic, timers, store, fetchImpl, random });
    this.config = undefined;
    this.configTries = 0;
    this.configTimer = undefined;
    this.configReading = undefined;
    /** /data: undefined (not read yet), 'ok', 'missing' or 'unreadable'. */
    this.dataState = undefined;
    this.loading = undefined;
    this.loadTimer = undefined;
    this.storeTimer = undefined;
    this.saveFailed = false;
    this.salt = undefined;
    /** Refused hooks: slot -> 8-bit mark of its URL. */
    this.refused = {};
    /** Tasks counted for the caps: { mono, wall, n }. */
    this.calls = [];
    this.pause = { untilMono: 0, untilWall: 0, why: undefined, streak: 0 };
    this.pauseTimer = undefined;
    /** Loop guard: when the last event was received, and the sends that followed one. */
    this.lastInbound = undefined;
    this.reactive = [];
    this.inboundTimes = [];
    this.inboundRefusedLog = undefined;
    this.inboundBurstLog = undefined;
    /** Requests that left (given back or not): the per-minute bound. */
    this.sent = [];
    /** 4xx answers in a row (given back): a growing pause from the third. */
    this.clientErrors = 0;
    /** Gladys Plus: undefined (not read), or { available, ready }. */
    this.plus = undefined;
    this.queue = Promise.resolve();
    this.waiting = 0;
    this.running = false;
    this.generation = 0;
    this.lastStatus = undefined;
    this.statusJob = Promise.resolve();
  }

  // --- Life cycle ---------------------------------------------------------------

  async start() {
    this.running = true;
    const gen = (this.generation += 1);
    this.loadState();
    await Promise.all([this.readConfig(gen), this.refreshWebhooks()]);
  }

  /** Every (re)connection: started once, then the config and Gladys Plus read again. */
  async connected() {
    if (!this.running) return this.start();
    this.lastStatus = undefined;
    await Promise.all([this.readConfig(this.generation), this.refreshWebhooks()]);
    this.publishStatus();
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    for (const key of ['configTimer', 'loadTimer', 'storeTimer', 'pauseTimer']) {
      if (this[key]) this.timers.clearTimeout(this[key]);
      this[key] = undefined;
    }
    await this.idle();
  }

  /** Resolves when the queued jobs and the status are done (tests, stop). */
  async idle() {
    await this.queue;
    await this.statusJob;
  }

  // --- Configuration ------------------------------------------------------------

  /** Reads the configuration; on failure, again later, spaced, without end. */
  async readConfig(gen) {
    if (this.configReading) return this.configReading;
    this.configReading = (async () => {
      try {
        const raw = await this.gladys.getConfig();
        if (gen !== this.generation) return;
        this.applyConfig(raw);
      } catch (err) {
        if (gen !== this.generation) return;
        const delay = CONFIG_RETRY[Math.min(this.configTries, CONFIG_RETRY.length - 1)];
        this.configTries += 1;
        this.logger.warn(
          `Configuration not read (${err?.code ?? err?.name ?? 'error'}): new try in ${delay / 1000} s`,
        );
        if (!this.config)
          this.publishStatus({ connected: false, message: T.status.config_unread(delay / 1000) });
        if (this.configTimer) this.timers.clearTimeout(this.configTimer);
        this.configTimer = this.timers.setTimeout(() => {
          this.configTimer = undefined;
          if (this.running && gen === this.generation) this.readConfig(gen);
        }, delay);
      } finally {
        this.configReading = undefined;
      }
    })();
    return this.configReading;
  }

  applyConfig(raw) {
    this.config = normalizeConfig(raw ?? {});
    this.configTries = 0;
    if (this.configTimer) this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    this.publishStatus();
  }

  /**
   * onConfigUpdated: nothing is sent, only the status changes. A hook URL
   * changed during the run lifts its refusal (the new URL is always tried:
   * its 8-bit mark could match by chance); saving the configuration also
   * lifts a loop pause (the user fixed the scene).
   */
  configUpdated(raw) {
    const before = this.config?.hooks;
    this.applyConfig(raw);
    let changed = false;
    for (const slot of Object.keys(this.refused)) {
      if (before && before[slot]?.url !== this.config.hooks[slot]?.url) {
        delete this.refused[slot];
        changed = true;
      }
    }
    if (this.pause.why === 'loop' && this.pause.untilMono > this.monotonic()) {
      this.clearPause();
      this.reactive = [];
      changed = true;
    }
    if (changed) {
      this.save();
      this.publishStatus();
    }
  }

  /** The config for a request: read once more (bounded) when not read yet. */
  async configForSend() {
    if (!this.config && this.running) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(resolve, 3_000);
      });
      await Promise.race([this.readConfig(this.generation), late]);
      this.timers.clearTimeout(timer);
    }
    if (!this.config) throw new NotSent('config_unread');
    return this.config;
  }

  // --- Gladys Plus ------------------------------------------------------------------

  /** Reads the webhook state (bounded); on failure the state is unknown, said in the status. */
  async refreshWebhooks() {
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), WEBHOOKS_TIMEOUT);
    });
    try {
      const job = Promise.resolve().then(() => this.gladys.getWebhooks());
      job.catch(() => {});
      const info = await Promise.race([job, late]);
      if (info === 'timeout') throw new Error('timeout');
      this.applyWebhooks(info);
    } catch (err) {
      this.logger.warn(`Gladys Plus state not read (${err?.code ?? err?.message ?? 'error'})`);
      this.plus = undefined;
      this.publishStatus();
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /** onWebhookUpdated and the reads: only whether the inbound URL exists (never the URL). */
  applyWebhooks(info) {
    const available = Boolean(info?.available);
    const hooks = Array.isArray(info?.webhooks) ? info.webhooks : [];
    const ready =
      available && hooks.some((w) => w?.key === WEBHOOKS.INBOUND && typeof w.url === 'string');
    this.plus = { available, ready };
    this.publishStatus();
  }

  // --- /data ----------------------------------------------------------------------

  /**
   * One read at a time. A read that takes more than 3 s counts as unreadable
   * for now (its result is still applied if it ends); unreadable: read again
   * every 10 s.
   */
  loadState() {
    if (this.loading || this.dataState === 'ok' || this.dataState === 'missing') return;
    const gen = this.generation;
    this.loading = Promise.resolve()
      .then(() => this.store.load())
      .catch(() => ({ status: 'unreadable' }))
      .then((result) => {
        this.loading = undefined;
        if (this.loadTimer) this.timers.clearTimeout(this.loadTimer);
        this.loadTimer = undefined;
        if (gen !== this.generation || !this.running) return;
        this.restore(result);
      });
    if (this.loadTimer) this.timers.clearTimeout(this.loadTimer);
    this.loadTimer = this.timers.setTimeout(() => {
      this.loadTimer = undefined;
      if (this.loading && gen === this.generation && this.running) {
        this.restore({ status: 'unreadable' });
      }
    }, LOAD_TIMEOUT);
  }

  /** The next read of an unreadable /data, 10 s later (later again while one hangs). */
  retryLoad() {
    if (this.storeTimer || !this.running) return;
    this.storeTimer = this.timers.setTimeout(() => {
      this.storeTimer = undefined;
      if (!this.running) return;
      if (this.loading) this.retryLoad();
      else this.loadState();
    }, STORE_RETRY);
  }

  /** Before a send: /data read (the first read is bounded). Unreadable refuses. */
  async dataForSend() {
    if (this.dataState === undefined && this.running) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(resolve, LOAD_TIMEOUT + 100);
      });
      await Promise.race([this.loading ?? Promise.resolve(), late]);
      this.timers.clearTimeout(timer);
    }
    if (this.dataState === undefined) throw new NotSent('data_pending');
    if (this.dataState === 'unreadable') throw new NotSent('data_unreadable');
  }

  restore(result) {
    if (result.status === 'unreadable') {
      if (this.dataState !== 'unreadable')
        this.logger.warn('/data is unreadable or too slow: read again every 10 s');
      this.dataState = 'unreadable';
      this.publishStatus();
      this.retryLoad();
      return;
    }
    const data = result.status === 'ok' ? result.data : {};
    const wall = this.now();
    const mono = this.monotonic();
    // The tasks of the last 30 days. A future wall date (a clock behind at
    // boot) is kept as written, so the entry lasts longer once the clock is
    // right again, never shorter; at most one window ahead.
    const kept = [];
    for (const item of Array.isArray(data.calls) ? data.calls.slice(-MAX_CALLS_KEPT) : []) {
      const count = item?.n;
      if (typeof item?.wall !== 'number' || !Number.isFinite(item.wall)) continue;
      if (!Number.isInteger(count) || count < 1 || count > 1_000_000) continue;
      const age = Math.max(0, wall - item.wall);
      if (age >= MONTH) continue;
      kept.push({ mono: mono - age, wall: Math.min(item.wall, wall + MONTH), n: count });
    }
    this.calls = [...kept, ...this.calls];
    this.trimCalls();
    // The pause: a remaining time bounded by the maximum.
    const until = data.pause?.until;
    if (typeof until === 'number' && Number.isFinite(until) && until > wall) {
      const why = PAUSE_WHY.includes(data.pause.why) ? data.pause.why : 'server';
      const left = Math.min(until - wall, why === 'loop' ? LOOP_PAUSE : PAUSE_MAX);
      if (mono + left > this.pause.untilMono) this.setPause(left, why, false);
    }
    const streak = data.pause?.streak;
    if (Number.isInteger(streak) && streak >= 0 && streak < 20) {
      this.pause.streak = Math.max(this.pause.streak, streak);
    }
    // The refused hooks: their marks under the salt of /data.
    if (typeof data.salt === 'string' && /^[0-9a-f]{32}$/.test(data.salt)) {
      this.salt = data.salt;
      const refused = data.refused && typeof data.refused === 'object' ? data.refused : {};
      for (const slot of ZAPS) {
        if (typeof refused[slot] === 'string' && /^[0-9a-f]{2}$/.test(refused[slot])) {
          this.refused[slot] ??= refused[slot];
        }
      }
    }
    this.dataState = result.status;
    this.publishStatus();
  }

  snapshot() {
    return {
      salt: this.salt,
      refused: { ...this.refused },
      pause:
        this.pause.untilMono > this.monotonic()
          ? { until: this.pause.untilWall, why: this.pause.why, streak: this.pause.streak }
          : { streak: this.pause.streak },
      calls: this.calls.map(({ wall, n }) => ({ wall, n })),
    };
  }

  /** Saves the state, bounded in time; never over an unreadable /data. Resolves true when saved. */
  async save() {
    if (this.dataState !== 'ok' && this.dataState !== 'missing') return false;
    if (!this.salt) this.salt = this.random(16);
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), SAVE_TIMEOUT);
    });
    try {
      const job = Promise.resolve()
        .then(() => this.store.save(this.snapshot()))
        .then(() => 'ok');
      job.catch(() => {});
      const outcome = await Promise.race([job, late]);
      if (outcome !== 'ok') this.logger.warn('/data not saved in time');
      else if (this.dataState === 'missing') this.dataState = 'ok';
      this.noteSave(outcome === 'ok');
      return outcome === 'ok';
    } catch (err) {
      this.logger.warn(`/data not saved: ${err?.code ?? 'error'}`);
      this.noteSave(false);
      return false;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  noteSave(ok) {
    if (this.saveFailed === !ok) return;
    this.saveFailed = !ok;
    this.publishStatus();
  }

  // --- Guards -----------------------------------------------------------------------

  isRefused(slot, url) {
    const mark = this.refused[slot];
    return Boolean(mark && this.salt && hookMark(this.salt, url) === mark);
  }

  /** A pause of `ms` (60 s to 6 h; a pause read back from /data keeps its remaining time). */
  setPause(ms, why, grow = true) {
    const delay = Math.min(PAUSE_MAX, Math.max(grow ? PAUSE_MIN : 1, ms));
    this.pause.untilMono = this.monotonic() + delay;
    this.pause.untilWall = this.now() + delay;
    this.pause.why = why;
    if (grow) this.pause.streak = Math.min(this.pause.streak + 1, 19);
    if (this.pauseTimer) this.timers.clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    // After stop() the pause is kept in memory and in /data, but no timer
    // outlives the app.
    if (!this.running) return;
    this.pauseTimer = this.timers.setTimeout(() => {
      this.pauseTimer = undefined;
      this.publishStatus();
    }, delay + 1);
  }

  clearPause() {
    this.pause.untilMono = 0;
    this.pause.untilWall = 0;
    this.pause.why = undefined;
    if (this.pauseTimer) this.timers.clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
  }

  paused(mono) {
    return mono < this.pause.untilMono;
  }

  /**
   * At most MAX_CALLS_KEPT entries: beyond, the two oldest are merged at the
   * date of the newer one (the caps then keep them a little longer, never
   * shorter).
   */
  trimCalls() {
    while (this.calls.length > MAX_CALLS_KEPT) {
      const [a, b] = this.calls;
      this.calls.splice(0, 2, { mono: b.mono, wall: b.wall, n: a.n + b.n });
    }
  }

  /** Tasks counted in the `window` before `mono` (the 30-day window prunes the list). */
  used(mono, window) {
    this.calls = this.calls.filter((c) => mono - c.mono < MONTH);
    return this.calls.filter((c) => mono - c.mono < window).reduce((sum, c) => sum + c.n, 0);
  }

  /** Requests that left in the last minute, given back or not. */
  sendsLastMinute(mono) {
    this.sent = this.sent.filter((at) => mono - at < MINUTE);
    return this.sent.length;
  }

  /** Whether a send at `mono` follows an event received from Zapier. */
  isReactive(mono) {
    return this.lastInbound !== undefined && mono - this.lastInbound < LOOP_WINDOW;
  }

  // --- Sending ----------------------------------------------------------------------

  /** The fields of a scene action, checked; throws NotSent. */
  static readFields(fields, config, json) {
    const slot = typeof fields.zap === 'string' ? fields.zap.trim() : String(fields.zap ?? '1');
    if (!ZAPS.includes(slot)) throw new NotSent('bad_zap');
    if (config.issues.includes(`bad_hook_${slot}`)) throw new NotSent('bad_hook');
    const hook = config.hooks[slot];
    if (!hook) throw new NotSent('no_hook');
    const event = typeof fields.event === 'string' ? fields.event.trim() : '';
    if (!EVENT_NAME.test(event)) throw new NotSent('bad_event');
    let extra = {};
    if (json) {
      const raw = typeof fields.payload === 'string' ? fields.payload.trim() : '';
      if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw new NotSent('json_too_large');
      if (raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new NotSent('bad_json');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new NotSent('bad_json');
        }
        extra = parsed;
      }
    } else {
      for (const key of ['value1', 'value2', 'value3']) {
        const value = valueOf(fields[key]);
        if (value !== '') extra[key] = value;
      }
    }
    return { slot, hook, event, extra };
  }

  /**
   * Sends one event to the Zap of `fields.zap`. Resolves
   * `{ request_id, zap_runs }`; throws NotSent when nothing left, or a NotSent
   * with `maybe` when Zapier may have taken it.
   */
  async send(fields = {}, { json = false, budget = SCENE_BUDGET, test = false } = {}) {
    const called = this.monotonic();
    const deadline = called + budget;
    // A send is a reply to an event when the scene CALLS it soon after: the
    // wait in the queue does not take it out of the window.
    const reactive = this.isReactive(called);
    const config = await this.configForSend();
    const job = App.readFields(fields, config, json);
    await this.dataForSend();
    if (this.waiting >= MAX_QUEUE) throw new NotSent('queue_full');
    this.waiting += 1;
    const gen = this.generation;
    const run = this.queue.then(() => this.sendOne({ ...job, deadline, gen, test, reactive }));
    this.queue = run.catch(() => {});
    try {
      return await run;
    } finally {
      this.waiting -= 1;
    }
  }

  /** Why nothing may leave now, or undefined. The clock is read once. */
  blocked({ deadline, gen, slot, hook, test, reactive }, mono) {
    if (!this.running || gen !== this.generation) return 'stopped';
    if (deadline - mono < SEND_MARGIN) return 'time';
    if (this.paused(mono)) return this.pause.why === 'loop' ? 'loop' : `paused_${this.pause.why}`;
    // The configuration may have changed while the job waited for its turn.
    const current = this.config.hooks[slot];
    if (!current || current.url !== hook.url) return 'no_hook';
    // The test button may try a refused hook again (a click), a scene never.
    if (!test && this.isRefused(slot, hook.url)) return 'refused';
    if (this.dataState === 'unreadable') return 'data_unreadable';
    if (this.sendsLastMinute(mono) >= MAX_PER_MINUTE) return 'burst';
    if (this.used(mono, DAY) + hook.zaps > this.config.maxPerDay) return 'cap_day';
    if (this.used(mono, MONTH) + hook.zaps > this.config.maxPerMonth) return 'cap_month';
    if (reactive) {
      this.reactive = this.reactive.filter((at) => mono - at < LOOP_SPAN);
      if (this.reactive.length >= LOOP_MAX) {
        this.setPause(LOOP_PAUSE, 'loop', false);
        this.logger.warn('Probable loop between a Zap and a scene: sends stopped for 30 min');
        this.save();
        this.publishStatus();
        return 'loop';
      }
    }
    return undefined;
  }

  async sendOne({ slot, hook, event, extra, deadline, gen, test, reactive }) {
    const mono = this.monotonic();
    const why = this.blocked({ deadline, gen, slot, hook, test, reactive }, mono);
    if (why) {
      const out = new NotSent(why);
      if (why.startsWith('paused_')) {
        out.minutes = Math.max(1, Math.ceil((this.pause.untilMono - mono) / 60_000));
      }
      throw out;
    }
    const entry = { mono, wall: this.now(), n: hook.zaps };
    // Counted and saved before the request leaves: a crash after it cannot
    // free the tasks. No save, no request.
    this.calls.push(entry);
    this.trimCalls();
    if (reactive) this.reactive.push(mono);
    const saved = await this.save();
    const giveBack = async (code) => {
      this.release(entry, reactive && mono);
      await this.save();
      throw new NotSent(code);
    };
    if (!saved) {
      this.release(entry, reactive && mono);
      throw new NotSent('data_unwritable');
    }
    if (!this.running || gen !== this.generation) await giveBack('stopped');
    if (deadline - this.monotonic() < SEND_MARGIN - SAVE_TIMEOUT) await giveBack('time');
    const body = { ...extra, event, source: 'gladys', sent_at: new Date(entry.wall).toISOString() };
    if (test) body.test = true;
    this.sent.push(this.monotonic());
    let answer;
    try {
      answer = await postHook(hook.url, body, { fetchImpl: this.fetchImpl, now: this.now });
    } catch (err) {
      if (!(err instanceof ZapierError)) throw err;
      if (err.sent !== 'maybe') this.release(entry, reactive && mono);
      this.onFailure(err, slot, hook);
      this.logger.warn(
        `Send to Catch Hook ${slot} ${err.sent === 'maybe' ? 'may have been taken' : 'not taken'}: ${err.code}${err.status ? ` (${err.status})` : ''}`,
      );
      await this.save();
      this.publishStatus();
      const out = new NotSent(err.code);
      out.maybe = err.sent === 'maybe';
      throw out;
    }
    // Answered with a 2xx: Zapier took it, whatever the body says.
    this.pause.streak = 0;
    this.clientErrors = 0;
    if (this.refused[slot]) delete this.refused[slot];
    await this.save();
    this.publishStatus();
    const id = answer.json?.request_id ?? answer.json?.id;
    this.logger.info(`Event sent to Catch Hook ${slot} (${hook.zaps} Zap run(s) counted)`);
    return {
      request_id: typeof id === 'string' && REQUEST_ID.test(id) ? id : '',
      zap_runs: hook.zaps,
    };
  }

  release(entry, reactiveAt) {
    const i = this.calls.indexOf(entry);
    if (i >= 0) this.calls.splice(i, 1);
    if (reactiveAt !== false && reactiveAt !== undefined) {
      const j = this.reactive.lastIndexOf(reactiveAt);
      if (j >= 0) this.reactive.splice(j, 1);
    }
    // The counts shown in the status change with it.
    this.publishStatus();
  }

  /** What a failure changes for the next requests (pause, refusal). */
  onFailure(err, slot, hook) {
    if (err.code === 'gone') {
      if (!this.salt) this.salt = this.random(16);
      this.refused[slot] = hookMark(this.salt, hook.url);
    } else if (err.code === 'rate_limited') {
      this.setPause(err.retryAfter ?? PAUSE_MIN * 2 ** this.pause.streak, 'rate_limited');
    } else if (err.code === 'server') {
      this.setPause(Math.max(err.retryAfter ?? 0, PAUSE_MIN * 2 ** this.pause.streak), 'server');
    } else if (err.sent === 'no' && err.status >= 300 && err.status < 500) {
      // A Zap refusing every send (a 4xx, a redirect) is not hammered: from
      // the third in a row, a pause of 60 s doubled each time, 6 h at most.
      this.clientErrors += 1;
      if (this.clientErrors >= 3) {
        this.setPause(PAUSE_MIN * 2 ** Math.min(this.clientErrors - 3, 10), 'client', false);
      }
    }
  }

  // --- Handlers -----------------------------------------------------------------------

  /** Scene actions "send_event" and "send_json": outputs, or an error for the scene log. */
  async sceneSend(fields = {}, json = false) {
    try {
      return await this.send(fields, { json, budget: SCENE_BUDGET });
    } catch (err) {
      if (err instanceof NotSent) {
        throw sceneError(
          reasonMessage(err.code, err.maybe ? T.prefix.maybe : T.prefix.nothing, err.minutes),
        );
      }
      throw err;
    }
  }

  /** Button "Send a test event": one event `gladys_test` to the Zap chosen, counted. */
  async sendTest(fields = {}) {
    const zap = typeof fields.zap === 'string' && fields.zap ? fields.zap : '1';
    let message;
    try {
      const out = await this.send(
        { zap, event: 'gladys_test', value1: 'Gladys', value2: 'test' },
        { budget: BUTTON_BUDGET, test: true },
      );
      message = T.test.ok(zap, out.zap_runs);
    } catch (err) {
      if (!(err instanceof NotSent)) throw err;
      message = reasonMessage(err.code, err.maybe ? T.prefix.maybe : T.prefix.nothing, err.minutes);
    }
    return join(message, this.inboundText());
  }

  /**
   * A request relayed by Gladys Plus -> the `zap_received` scene event.
   * Never sends anything to Zapier. Bounded: 60 events per minute.
   */
  async handleInbound(request) {
    const mono = this.monotonic();
    const config = this.config;
    if (!config) {
      this.logger.warn('Inbound request ignored: configuration not read yet');
      return;
    }
    const result = inboundEvent(request, {
      secret: config.inboundSecret,
      locked: config.inboundLocked,
    });
    if (!result.ok) {
      // Refusals have their own count: they never take the room of the
      // accepted events, and the log says it once per minute at most.
      if (this.inboundRefusedLog === undefined || mono - this.inboundRefusedLog >= MINUTE) {
        this.inboundRefusedLog = mono;
        this.logger.warn(`Inbound request ignored: ${result.reason} (once per minute in the log)`);
      }
      return;
    }
    this.inboundTimes = this.inboundTimes.filter((at) => mono - at < MINUTE);
    if (this.inboundTimes.length >= MAX_INBOUND_PER_MINUTE) {
      if (this.inboundBurstLog === undefined || mono - this.inboundBurstLog >= MINUTE) {
        this.inboundBurstLog = mono;
        this.logger.warn('Inbound events ignored: more than 60 in a minute');
      }
      return;
    }
    this.inboundTimes.push(mono);
    // Before publishing: a scene the event starts sends right after.
    this.lastInbound = mono;
    try {
      await this.gladys.publishSceneEvent(SCENE_TRIGGERS.RECEIVED, result.data);
      this.logger.info('Event received from Zapier');
    } catch (err) {
      this.logger.warn(`Scene event not published (${err?.status ?? err?.code ?? 'error'})`);
    }
  }

  // --- Status -------------------------------------------------------------------------

  inboundText() {
    if (this.config?.inboundLocked) return T.inbound.locked;
    if (!this.plus) return T.inbound.unknown;
    return this.plus.ready ? T.inbound.ready : T.inbound.no_plus;
  }

  currentStatus() {
    const c = this.config;
    if (!c) return undefined;
    const inbound = this.inboundText();
    const bad = ZAPS.filter((slot) => c.issues.includes(`bad_hook_${slot}`));
    if (bad.length) return { connected: false, message: join(T.status.bad_hook(bad), inbound) };
    const slots = ZAPS.filter((slot) => c.hooks[slot]);
    if (!slots.length) {
      if (this.plus?.ready && !c.inboundLocked)
        return { connected: true, message: join(T.status.receive_only, inbound) };
      return { connected: false, message: join(T.status.no_hook, inbound) };
    }
    const mono = this.monotonic();
    if (this.paused(mono)) {
      const minutes = Math.max(1, Math.ceil((this.pause.untilMono - mono) / 60_000));
      return { connected: false, message: join(T.status.paused(minutes, this.pause.why), inbound) };
    }
    if (this.dataState === 'unreadable')
      return { connected: false, message: join(T.status.data_unreadable, inbound) };
    const refused = slots.filter((slot) => this.isRefused(slot, c.hooks[slot].url));
    const usable = slots.filter((slot) => !refused.includes(slot));
    const message = usable.length
      ? T.status.ready({
          slots: usable,
          day: this.used(mono, DAY),
          maxDay: c.maxPerDay,
          month: this.used(mono, MONTH),
          maxMonth: c.maxPerMonth,
        })
      : { en: '', fr: '' };
    if (refused.length) {
      const r = T.status.refused(refused);
      message.en = `${message.en}${r.en}`.trim();
      message.fr = `${message.fr}${r.fr}`.trim();
    }
    if (this.saveFailed) {
      message.en += T.status.data_unwritable.en;
      message.fr += T.status.data_unwritable.fr;
    }
    return { connected: usable.length > 0, message: join(message, inbound) };
  }

  /** One status at a time, the same one never twice, bounded in time. */
  publishStatus(state = this.currentStatus()) {
    if (!state || !this.running) return;
    const gen = this.generation;
    this.statusJob = this.statusJob.then(async () => {
      if (gen !== this.generation) return;
      const key = JSON.stringify(state);
      if (key === this.lastStatus) return;
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('timeout'), STATUS_TIMEOUT);
      });
      try {
        const sent = Promise.resolve(
          this.gladys.setConnectionStatus(state.connected, state.message),
        );
        sent.catch(() => {});
        if ((await Promise.race([sent.then(() => 'ok'), late])) === 'ok') this.lastStatus = key;
        else this.logger.warn('Status not published in time');
      } catch (err) {
        this.logger.warn(`Status not published: ${err?.message ?? err}`);
      } finally {
        this.timers.clearTimeout(timer);
      }
    });
  }
}
