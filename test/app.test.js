// -----------------------------------------------------------------------------
// The app on the fake Gladys of the SDK, a scripted Zapier and a virtual
// clock that moves at each read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import { hookMark } from '../src/app.js';
import { SCENE_ACTIONS } from '../src/constants.js';
import {
  BASE_CONFIG,
  DAY,
  FIELDS,
  HOOK1,
  HOOK2,
  HOOK3,
  HOUR,
  MINUTE,
  PLUS_URL,
  SECOND,
  SECRET,
  json,
  lastStatus,
  leaked,
  setup,
} from './helpers/app.js';

const failed = (ack) => ack.success === false;
const message = (ack) => String(ack.error ?? ack.message ?? JSON.stringify(ack));

test('send_event: one POST to the hook, counted and saved before it leaves', async () => {
  let savedBefore;
  const store = createMemoryStore();
  const b = await setup({
    store,
    handler: () => {
      savedBefore = store.data?.calls?.length;
    },
  });
  const ack = await b.scene();
  assert.equal(ack.success, true, message(ack));
  assert.deepEqual(ack.data.outputs, { request_id: 'req-1', tasks: 1 });
  assert.equal(b.api.requests.length, 1);
  const [r] = b.api.requests;
  assert.equal(r.url, HOOK1);
  assert.equal(r.method, 'POST');
  assert.equal(r.init.redirect, 'manual');
  assert.match(
    r.headers['User-Agent'],
    /^gladys-zapier\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-zapier\)$/,
  );
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.equal(r.headers.Accept, 'application/json');
  assert.deepEqual(r.body, {
    event: 'door_opened',
    value1: 'PRIVATE-VALUE',
    source: 'gladys',
    sent_at: '2026-11-15T09:00:00.000Z',
  });
  assert.equal(savedBefore, 1, 'the count is in /data before the request');
});

test('a hook naming two Zaps counts two tasks; the slot without URL refuses', async () => {
  const b = await setup({ config: { hook_1: HOOK1, hook_2: HOOK2, max_sends_per_day: 3 } });
  let ack = await b.scene({ zap: '2', event: 'x' });
  assert.equal(ack.data.outputs.tasks, 2);
  ack = await b.scene({ zap: '2', event: 'x' });
  assert.ok(failed(ack));
  assert.match(message(ack), /24 hours/);
  ack = await b.scene({ zap: '1', event: 'x' });
  assert.equal(ack.success, true, 'one task still fits');
  ack = await b.scene({ zap: '3', event: 'x' });
  assert.ok(failed(ack));
  assert.match(message(ack), /no Catch Hook URL/);
  assert.equal(b.api.requests.length, 2);
});

test('the daily cap frees a task 24 hours after it, never sooner', async () => {
  const b = await setup({ config: { ...BASE_CONFIG, max_sends_per_day: 2 } });
  await b.scene();
  await b.wait(2 * MINUTE);
  await b.scene();
  let ack = await b.scene();
  assert.ok(failed(ack));
  assert.match(message(ack), /Nothing sent to Zapier: the cap of tasks over 24 hours/);
  await b.wait(DAY - 3 * MINUTE);
  ack = await b.scene();
  assert.ok(failed(ack), 'still within 24 hours of the first');
  await b.wait(2 * MINUTE);
  ack = await b.scene();
  assert.equal(ack.success, true, message(ack));
  assert.equal(b.api.requests.length, 3);
});

test('the 30-day cap; the caps survive a restart (and a wall clock set back)', async () => {
  const store = createMemoryStore();
  const config = { ...BASE_CONFIG, max_sends_per_month: 3 };
  const a = await setup({ store, config });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await a.scene()).success, true);
    await a.wait(DAY);
  }
  assert.match(message(await a.scene()), /30 days/);
  await a.app.stop();
  const b = await setup({ store, config, now: Date.parse('2026-11-10T00:00:00Z') });
  assert.match(message(await b.scene()), /30 days/, 'a clock behind keeps the count');
  const c = await setup({ store, config, now: Date.parse('2026-12-20T00:00:00Z') });
  assert.equal((await c.scene()).success, true, '30 days later the tasks are free');
});

test('at most 10 sends per minute, whatever the caps', async () => {
  const b = await setup({ config: { ...BASE_CONFIG, max_sends_per_day: 2000 } });
  for (let i = 0; i < 10; i += 1) assert.equal((await b.scene()).success, true);
  const ack = await b.scene();
  assert.match(message(ack), /more than 10 sends in a minute/);
  await b.wait(MINUTE);
  assert.equal((await b.scene()).success, true);
  assert.equal(b.api.requests.length, 11);
});

test('no save, no request; an unreadable /data refuses and is read again every 10 s', async () => {
  const store = createMemoryStore();
  const b = await setup({ store });
  store.failSave = true;
  let ack = await b.scene();
  assert.match(message(ack), /could not be saved in \/data/);
  assert.equal(b.api.requests.length, 0);
  assert.match(lastStatus(b.gladys).message.en, /could not be written/);
  store.failSave = false;
  assert.equal((await b.scene()).success, true);

  const broken = createMemoryStore({ calls: [] });
  broken.unreadable = true;
  const c = await setup({ store: broken });
  ack = await c.scene();
  assert.match(message(ack), /unreadable/);
  assert.equal(lastStatus(c.gladys).connected, false);
  assert.equal(broken.saves, 0, 'never overwritten');
  broken.unreadable = false;
  await c.wait(10 * SECOND + 10);
  assert.equal((await c.scene()).success, true);
  assert.equal(c.api.requests.length, 1);
});

test('a send that may have been taken is counted and never tried again', async () => {
  for (const kind of ['timeout', 'ECONNRESET', 'UND_ERR_SOCKET']) {
    const b = await setup({
      config: { ...BASE_CONFIG, max_sends_per_day: 5 },
      handler: () => kind,
    });
    const ack = await b.scene();
    assert.match(message(ack), /without a clear answer/, kind);
    assert.equal(b.api.requests.length, 1, `${kind}: one try`);
    assert.equal(b.store.data.calls.length, 1, `${kind}: counted`);
  }
  for (const kind of ['ENOTFOUND', 'ECONNREFUSED']) {
    const b = await setup({ handler: () => kind });
    const ack = await b.scene();
    assert.match(message(ack), /Nothing sent to Zapier: network error/, kind);
    assert.equal(b.store.data.calls.length, 0, `${kind}: given back`);
  }
});

test('400, 401, 403, 413, a redirect: given back, no pause, the hook not refused', async () => {
  for (const status of [400, 401, 403, 413, 301]) {
    const b = await setup({
      handler: () => (b.api.requests.length === 1 ? json({}, status) : undefined),
    });
    const ack = await b.scene();
    assert.ok(failed(ack), String(status));
    assert.match(message(ack), /Nothing sent/);
    assert.equal(b.store.data.calls.length, 0, `${status}: given back`);
    assert.equal((await b.scene()).success, true, `${status}: the next send leaves`);
  }
});

test('429: a pause of Retry-After bounded to 60 s..6 h, kept across a restart', async () => {
  const store = createMemoryStore();
  let n = 0;
  const handler = () => ((n += 1) === 1 ? json({}, 429, { 'retry-after': '600' }) : undefined);
  const a = await setup({ store, handler });
  assert.match(message(await a.scene()), /slow down \(429\)/);
  assert.equal(store.data.calls.length, 0, 'a 429 uses no task');
  assert.match(message(await a.scene()), /asked for a pause/);
  assert.equal(n, 1);
  assert.match(lastStatus(a.gladys).message.en, /429/);
  await a.wait(5 * MINUTE);
  await a.app.stop();
  const b = await setup({ store, handler, now: Date.parse('2026-11-15T09:05:00Z') });
  assert.match(message(await b.scene()), /pause/, 'still paused after the restart');
  await b.wait(5 * MINUTE + SECOND);
  assert.equal((await b.scene()).success, true);

  let m = 0;
  const c = await setup({
    handler: () => ((m += 1) === 1 ? json({}, 429, { 'retry-after': '1' }) : undefined),
  });
  await c.scene();
  await c.wait(30 * SECOND);
  assert.match(message(await c.scene()), /pause/, 'never less than 60 s');
  await c.wait(31 * SECOND);
  assert.equal((await c.scene()).success, true);
  assert.equal(m, 2);
});

test('5xx: counted (may have run), pause of 60 s doubled on repeat', async () => {
  const b = await setup({ handler: () => json({}, 503) });
  assert.match(message(await b.scene()), /without a clear answer.*5xx/);
  assert.equal(b.store.data.calls.length, 1);
  await b.wait(61 * SECOND);
  await b.scene();
  await b.wait(61 * SECOND);
  assert.match(message(await b.scene()), /pause/, 'second pause is 120 s');
  await b.wait(60 * SECOND);
  await b.scene();
  assert.equal(b.api.requests.length, 3);
});

test('404/410: the hook is refused for scenes, kept in /data, lifted by a new URL or the button', async () => {
  const store = createMemoryStore();
  let gone = true;
  const handler = () => (gone ? json({}, 410) : undefined);
  const a = await setup({ store, handler });
  assert.match(message(await a.scene()), /knows no such hook/);
  assert.match(message(await a.scene()), /knew no such hook at the last send/);
  assert.equal(a.api.requests.length, 1, 'never sent again by a scene');
  assert.equal(store.data.calls.length, 0);
  assert.match(lastStatus(a.gladys).message.en, /Catch Hook 1: Zapier knows no such hook/);
  assert.equal(lastStatus(a.gladys).connected, false);
  await a.app.stop();
  const b = await setup({ store, handler });
  assert.match(message(await b.scene()), /knew no such hook/, 'kept across a restart');
  assert.equal(b.api.requests.length, 0);
  // The button tries again on a click; a success lifts the refusal.
  gone = false;
  const ack = await b.gladys.fake.action('send_test', { zap: '1' });
  assert.match(ack.data.message.en, /accepted the test event/);
  assert.equal((await b.scene()).success, true);
  // A new URL typed during the run is always tried.
  gone = true;
  await b.scene();
  await b.gladys.fake.configUpdated({ hook_1: HOOK3 });
  gone = false;
  assert.equal((await b.scene()).success, true);
  assert.equal(b.api.requests.at(-1).url, `${HOOK3}/`);
});

test('the loop guard: a fourth send right after events from Zapier stops sends for 30 min', async () => {
  const b = await setup();
  for (let i = 0; i < 3; i += 1) {
    await b.inbound({ event: 'ping' });
    assert.equal((await b.scene()).success, true, `round ${i + 1}`);
    await b.wait(20 * SECOND);
  }
  await b.inbound({ event: 'ping' });
  let ack = await b.scene();
  assert.match(message(ack), /probable loop/);
  assert.match(lastStatus(b.gladys).message.en, /Probable loop/);
  assert.equal(b.api.requests.length, 3);
  await b.wait(20 * MINUTE);
  assert.match(message(await b.scene()), /probable loop/, 'not a reactive send, still stopped');
  // Saving the configuration lifts it.
  await b.gladys.fake.configUpdated(BASE_CONFIG);
  ack = await b.scene();
  assert.equal(ack.success, true, message(ack));
  assert.equal(b.store.data.pause.until, undefined);
});

test('the loop guard ignores sends that do not follow an event', async () => {
  const b = await setup({ config: { ...BASE_CONFIG, max_sends_per_day: 100 } });
  for (let i = 0; i < 6; i += 1) {
    await b.inbound({ event: 'ping' });
    await b.wait(16 * SECOND);
    assert.equal((await b.scene()).success, true, `send ${i + 1}, 16 s after the event`);
  }
});

test('the loop pause is kept in /data', async () => {
  const store = createMemoryStore();
  const a = await setup({ store });
  for (let i = 0; i < 4; i += 1) {
    await a.inbound({ event: 'ping' });
    await a.scene();
    await a.wait(SECOND);
  }
  assert.equal(store.data.pause.why, 'loop');
  await a.app.stop();
  const b = await setup({ store, now: Date.parse('2026-11-15T09:10:00Z') });
  assert.match(message(await b.scene()), /probable loop/);
});

test('an event received: published once, never a send to Zapier', async () => {
  const b = await setup();
  await b.inbound({ event: 'new_order', value1: 'A', value2: 12, extra: 'x', secret: 'ignored' });
  assert.deepEqual(b.gladys.fake.sceneEvents, [
    {
      key: 'zap_received',
      data: {
        event: 'new_order',
        value1: 'A',
        value2: '12',
        value3: null,
        payload: '{"extra":"x"}',
      },
    },
  ]);
  assert.equal(b.api.requests.length, 0);
  // Form body and query string.
  await b.inbound('event=from_form&value1=b', { contentType: 'application/x-www-form-urlencoded' });
  await b.inbound('', { query: { event: 'from_query' }, method: 'GET' });
  assert.deepEqual(
    b.gladys.fake.sceneEvents.map((e) => e.data.event),
    ['new_order', 'from_form', 'from_query'],
  );
  await b.inbound({ value1: 'no event' });
  await b.inbound({ event: 'bad name!' });
  assert.equal(b.gladys.fake.sceneEvents.length, 3);
});

test('the shared secret: required when set, compared exactly, never logged', async () => {
  const b = await setup({ config: { ...BASE_CONFIG, inbound_secret: SECRET } });
  await b.inbound({ event: 'a' });
  await b.inbound({ event: 'a', secret: 'wrong-secret' });
  await b.inbound({ event: 'a', secret: `${SECRET}x` });
  assert.equal(b.gladys.fake.sceneEvents.length, 0);
  await b.inbound({ event: 'a', secret: SECRET });
  await b.inbound('', { query: { event: 'b', secret: SECRET } });
  assert.equal(b.gladys.fake.sceneEvents.length, 2);
  assert.ok(!JSON.stringify(b.gladys.fake.sceneEvents).includes(SECRET), 'not in payload');
  // A secret that does not read refuses everything (never accepts without it).
  await b.gladys.fake.configUpdated({ ...BASE_CONFIG, inbound_secret: 'short' });
  await b.inbound({ event: 'a', secret: 'short' });
  await b.inbound({ event: 'a' });
  assert.equal(b.gladys.fake.sceneEvents.length, 2);
  assert.match(lastStatus(b.gladys).message.en, /shared secret does not read/);
  assert.ok(!leaked(b).includes(SECRET));
});

test('events received: 60 per minute at most, a large body refused', async () => {
  const b = await setup();
  for (let i = 0; i < 65; i += 1) await b.app.handleInbound({ body: '{"event":"e"}' });
  assert.equal(b.gladys.fake.sceneEvents.length, 60);
  await b.wait(MINUTE);
  await b.app.handleInbound({ body: JSON.stringify({ event: 'e', pad: 'x'.repeat(70_000) }) });
  assert.equal(b.gladys.fake.sceneEvents.length, 60);
  await b.app.handleInbound({ body: '{"event":"e"}' });
  assert.equal(b.gladys.fake.sceneEvents.length, 61);
});

test('a scene event refused by Gladys stops nothing', async () => {
  const b = await setup();
  b.gladys.publishSceneEvent = async () => {
    throw Object.assign(new Error('Too many'), { status: 429 });
  };
  await b.app.handleInbound({ body: '{"event":"e"}' });
  assert.equal((await b.scene()).success, true);
});

test('status: Gladys Plus or not, receive only, no hook, a hook that does not read', async () => {
  let b = await setup({ webhooks: { available: false, webhooks: [] } });
  let s = lastStatus(b.gladys);
  assert.equal(s.connected, true);
  assert.match(s.message.en, /Ready to send to Catch Hook 1.*0 of 20 over 24 hours, 0 of 500/);
  assert.match(s.message.en, /needs Gladys Plus/);
  assert.match(s.message.fr, /nécessite Gladys Plus/);
  await b.gladys.fake.webhookUpdated({
    available: true,
    webhooks: [{ key: 'inbound', mode: 'fire_and_forget', url: PLUS_URL }],
  });
  await b.wait(0);
  assert.match(lastStatus(b.gladys).message.en, /From Zapier: ready/);
  b = await setup({ config: {} });
  s = lastStatus(b.gladys);
  assert.equal(s.connected, true, 'receive only through Gladys Plus');
  assert.match(s.message.en, /No Catch Hook URL/);
  b = await setup({ config: {}, webhooks: { available: false, webhooks: [] } });
  assert.equal(lastStatus(b.gladys).connected, false);
  assert.match(lastStatus(b.gladys).message.en, /Paste the Catch Hook URL/);
  for (const bad of [
    'https://hooks.zapier.com/hooks/catch/123/',
    'http://hooks.zapier.com/hooks/catch/1/abc/',
    'https://hooks.zapier.com.evil.example/hooks/catch/1/abc/',
    'https://hooks.zapier.com/hooks/catch/1/abc/?x=1',
    'https://hooks.zapier.com/hooks/catch/1/ab c/',
  ]) {
    b = await setup({ config: { hook_1: bad } });
    assert.equal(lastStatus(b.gladys).connected, false, bad);
    assert.match(lastStatus(b.gladys).message.en, /not a Zapier Catch Hook URL/, bad);
    assert.match(message(await b.scene()), /does not read/);
    assert.equal(b.api.requests.length, 0);
    assert.ok(!leaked(b).includes('evil'), 'the URL typed is never echoed');
  }
});

test('getConfig failing in connected: spaced retries without end, then the sends work', async () => {
  let fails = 2;
  let sdkRead = true;
  const b = await setup({
    start: false,
    getConfig: async () => {
      // The first read of each connect() is the SDK's own.
      if (sdkRead) {
        sdkRead = false;
        return BASE_CONFIG;
      }
      if (fails > 0) {
        fails -= 1;
        throw new Error('boom');
      }
      return BASE_CONFIG;
    },
  });
  await b.gladys.connect();
  await b.wait(0);
  assert.match(lastStatus(b.gladys).message.en, /could not be read.*5 s/);
  await b.wait(5 * SECOND);
  assert.match(lastStatus(b.gladys).message.en, /could not be read.*10 s/);
  await b.wait(10 * SECOND);
  assert.equal(lastStatus(b.gladys).connected, true);
  assert.equal((await b.scene()).success, true);
  // A reconnection whose read fails keeps the last config.
  fails = 1;
  sdkRead = true;
  await b.gladys.disconnect();
  await b.gladys.connect();
  await b.wait(0);
  assert.equal((await b.scene()).success, true);
  assert.equal(b.api.requests.length, 2);
});

test('one request at a time; 5 slow sends all leave; the queue is bounded', async () => {
  const b = await setup({
    config: { ...BASE_CONFIG, max_sends_per_day: 100 },
    handler: () => new Promise((resolve) => b.clock.timers.setTimeout(resolve, 900)),
  });
  const acks = Array.from({ length: 5 }, (_, i) => b.scene({ zap: '1', event: `e${i}` }));
  await b.run(10 * SECOND);
  for (const ack of await Promise.all(acks)) assert.equal(ack.success, true, message(ack));
  assert.equal(b.api.peak, 1);
  assert.deepEqual(
    b.api.requests.map((r) => r.body.event),
    ['e0', 'e1', 'e2', 'e3', 'e4'],
  );
  await b.wait(MINUTE);
  const many = Array.from({ length: 11 }, () => b.app.send(FIELDS).catch((err) => err.code));
  await b.run(30 * SECOND);
  const out = await Promise.all(many);
  assert.ok(out.includes('queue_full'));
});

test('a send whose time ran out behind slow ones sends nothing', async () => {
  const b = await setup({
    config: { ...BASE_CONFIG, max_sends_per_day: 100 },
    handler: () => new Promise((resolve) => b.clock.timers.setTimeout(resolve, 9_000)),
  });
  const acks = Array.from({ length: 3 }, () => b.scene());
  await b.run(40 * SECOND);
  const out = await Promise.all(acks);
  assert.equal(out[0].success, true);
  assert.equal(out[1].success, true, 'still 16 s left for the second');
  assert.match(message(out[2]), /no time left/);
  assert.equal(b.api.requests.length, 2);
  assert.equal(b.store.data.calls.length, 2, 'the late one is not counted');
  assert.equal(b.store.saves, 4, 'the late one is refused before its count is saved');
});

test('send_json: the object becomes fields; checked before anything leaves', async () => {
  const b = await setup();
  let ack = await b.scene(
    { zap: '1', event: 'j', payload: '{"temperature": 21.5, "event": "x", "__proto__": {"a": 1}}' },
    SCENE_ACTIONS.SEND_JSON,
  );
  assert.equal(ack.success, true, message(ack));
  const body = b.api.requests[0].body;
  assert.equal(body.temperature, 21.5);
  assert.equal(body.event, 'j', 'the event field wins');
  assert.equal(body.source, 'gladys');
  assert.deepEqual(body.__proto__, { a: 1 });
  assert.equal({}.a, undefined, 'no prototype pollution');
  for (const [payload, why] of [
    ['[1,2]', /not a JSON object/],
    ['{oops', /not a JSON object/],
    [JSON.stringify({ pad: 'x'.repeat(9000) }), /8 KB/],
  ]) {
    ack = await b.scene({ zap: '1', event: 'j', payload }, SCENE_ACTIONS.SEND_JSON);
    assert.match(message(ack), why);
  }
  for (const [fields, why] of [
    [{ zap: '1', event: 'bad name' }, /event name/],
    [{ zap: '1', event: '' }, /event name/],
    [{ zap: '9', event: 'x' }, /unknown Zap/],
    [{ zap: '1', event: 'x', value2: 'v'.repeat(1001) }, /1,000 characters/],
  ]) {
    assert.match(message(await b.scene(fields)), why);
  }
  assert.equal(b.api.requests.length, 1);
});

test('the test button: the event gladys_test, counted, with the inbound state', async () => {
  const b = await setup({ config: { hook_1: HOOK1, hook_2: HOOK2 } });
  const ack = await b.gladys.fake.action('send_test', { zap: '2' });
  assert.match(
    ack.data.message.en,
    /accepted the test event on Catch Hook 2 \(2 tasks counted\).*From Zapier: ready/,
  );
  assert.match(ack.data.message.fr, /tâches comptées/);
  const [r] = b.api.requests;
  assert.equal(r.url, HOOK2);
  assert.equal(r.body.event, 'gladys_test');
  assert.equal(r.body.test, true);
  assert.equal(b.store.data.calls[0].n, 2);
  assert.ok(!ack.data.message.en.includes('SECRETPLUSURL'), 'the Gladys Plus URL is not shown');
});

test('nothing secret in the logs, the statuses nor /data', async () => {
  const b = await setup({
    config: { hook_1: HOOK1, hook_2: HOOK2, inbound_secret: SECRET },
    handler: (r) =>
      r.body.event === 'fail' ? 'timeout' : r.body.event === 'gone' ? json({}, 404) : undefined,
  });
  await b.scene();
  await b.scene({ zap: '1', event: 'fail', value1: 'PRIVATE-VALUE' });
  await b.wait(MINUTE);
  await b.scene({ zap: '2', event: 'gone' });
  await b.inbound({ event: 'in', value1: 'PRIVATE-VALUE', secret: SECRET });
  await b.inbound({ event: 'in', secret: 'PRIVATE-WRONG' });
  const out = leaked(b);
  for (const secret of ['SECRETHOOK', '123456', SECRET, 'PRIVATE', 'SECRETPLUSURL']) {
    assert.ok(!out.includes(secret), secret);
  }
});

test('nothing leaves after stop; no timer survives it', async () => {
  const b = await setup();
  await b.app.stop();
  const ack = await b.app.send(FIELDS).catch((err) => err.code);
  assert.equal(ack, 'stopped');
  assert.equal(b.api.requests.length, 0);
  assert.equal(b.clock.pending, 0);
});

test('the counter entries are bounded; merged ones last longer, never shorter', async () => {
  const b = await setup({
    config: { ...BASE_CONFIG, max_sends_per_day: 2000, max_sends_per_month: 50000 },
  });
  for (let i = 0; i < 1005; i += 1)
    b.app.calls.push({ mono: b.clock.monotonic(), wall: b.clock.now(), n: 1 });
  b.app.trimCalls();
  assert.equal(b.app.calls.length, 1000);
  assert.equal(b.app.used(b.clock.monotonic(), DAY), 1005);
  await b.wait(HOUR);
});

test('a new URL lifts the refusal even when its 8-bit mark matches the refused one', async () => {
  const b = await setup({ handler: () => json({}, 404) });
  await b.scene();
  // Forge the 1-in-256 collision: the refused mark is the one of the new URL.
  b.app.refused['1'] = hookMark(b.app.salt, `${HOOK3}/`);
  await b.gladys.fake.configUpdated({ hook_1: HOOK3 });
  b.api.handler = undefined;
  assert.equal((await b.scene()).success, true);
  assert.equal(b.app.refused['1'], undefined);
});

test('a count dated in the future (clock behind) lasts longer, never shorter', async () => {
  const store = createMemoryStore({ calls: [{ wall: Date.parse('2026-11-15T10:00:00Z'), n: 1 }] });
  const b = await setup({ store, config: { ...BASE_CONFIG, max_sends_per_day: 1 } });
  await b.wait(23 * HOUR + 30 * MINUTE);
  assert.match(message(await b.scene()), /24 hours/);
  await b.wait(HOUR);
  assert.equal((await b.scene()).success, true);
});

test('an unreadable /data refuses before the queue', async () => {
  const broken = createMemoryStore({ calls: [] });
  broken.unreadable = true;
  const b = await setup({ store: broken });
  await assert.rejects(b.app.dataForSend(), { code: 'data_unreadable' });
});

test('a hook URL changed while a send waits in the queue: the old URL is not used', async () => {
  const b = await setup({
    handler: () => new Promise((resolve) => b.clock.timers.setTimeout(resolve, 2_000)),
  });
  const first = b.scene();
  const second = b.scene();
  await b.run(500);
  await b.gladys.fake.configUpdated({ hook_1: HOOK3 });
  await b.run(10 * SECOND);
  assert.equal((await first).success, true);
  assert.match(message(await second), /no Catch Hook URL/);
  assert.deepEqual(
    b.api.requests.map((r) => r.url),
    [HOOK1],
  );
});
