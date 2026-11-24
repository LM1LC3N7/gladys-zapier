// -----------------------------------------------------------------------------
// Keys of the manifest, bounds and delays. The manifest keys are forever: a
// renamed key is a removed key for every scene and configuration using it.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** The version of this integration, from package.json (copied in the image). */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;
export const USER_AGENT = `gladys-zapier/${VERSION} (+https://github.com/LM1LC3N7/gladys-zapier)`;

/**
 * A "Webhooks by Zapier" Catch Hook (or Catch Raw Hook) URL, as Zapier shows
 * it in the trigger of a Zap (help.zapier.com, "Trigger Zaps from webhooks",
 * read on 2026-11-15): https://hooks.zapier.com/hooks/catch/<account>/<hook>/.
 * Zapier documents joining the hook parts of several Zaps of the same account
 * with commas (…/catch/123456/zbB61,kzXC4/): every Zap named runs, each a task.
 */
export const HOOK_ORIGIN = 'https://hooks.zapier.com';
export const HOOK_URL =
  /^https:\/\/hooks\.zapier\.com\/hooks\/catch\/(\d{1,15})\/([A-Za-z0-9]{1,40}(?:,[A-Za-z0-9]{1,40}){0,9})\/?$/;

export const CONFIG = {
  HOOKS: ['hook_1', 'hook_2', 'hook_3'],
  MAX_PER_DAY: 'max_sends_per_day',
  MAX_PER_MONTH: 'max_sends_per_month',
  INBOUND_SECRET: 'inbound_secret',
};

/** The Zap choices of the scene actions and of the test button: the slot of the hook. */
export const ZAPS = ['1', '2', '3'];

export const ACTIONS = { TEST: 'send_test' };
export const SCENE_ACTIONS = { SEND: 'send_event', SEND_JSON: 'send_json' };
export const SCENE_TRIGGERS = { RECEIVED: 'zap_received' };
export const WEBHOOKS = { INBOUND: 'inbound' };

/** Defaults, mirrored by the manifest (test/manifest.test.js ties them). */
export const DEFAULTS = {
  [CONFIG.MAX_PER_DAY]: 20,
  [CONFIG.MAX_PER_MONTH]: 500,
};
/** Integer bounds [min, max] of the numeric options. */
export const BOUNDS = {
  [CONFIG.MAX_PER_DAY]: [1, 2000],
  [CONFIG.MAX_PER_MONTH]: [1, 50000],
};

/** The windows of the caps: a rolling 24 hours and a rolling 30 days, in ms. */
export const DAY = 24 * 60 * 60_000;
export const MONTH = 30 * DAY;
/** At most this many sends per rolling minute, whatever the caps (a scene in a loop). */
export const MAX_PER_MINUTE = 10;
export const MINUTE = 60_000;

/**
 * The loop guard. A send that leaves less than LOOP_WINDOW after an event
 * received from Zapier may be its consequence (a scene started by the event
 * sending to a Zap that calls Gladys again). LOOP_MAX such sends within
 * LOOP_SPAN stop every send for LOOP_PAUSE.
 */
export const LOOP_WINDOW = 15_000;
export const LOOP_MAX = 3;
export const LOOP_SPAN = 5 * 60_000;
export const LOOP_PAUSE = 30 * 60_000;

/** Event names, sent and received: letters, digits, `_`, `-`, `.`. */
export const EVENT_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
/** Longest value sent or relayed (the core caps a scene event string at 1000). */
export const MAX_VALUE = 1000;
/** Longest JSON object sent by "send_json", serialized. */
export const MAX_JSON_BYTES = 8 * 1024;
/** Longest inbound body read (Gladys Plus relays it as text). */
export const MAX_INBOUND_BYTES = 64 * 1024;
/** Inbound events published per rolling minute at most (the core admits 300 for everything). */
export const MAX_INBOUND_PER_MINUTE = 60;
/** Keys of an inbound event beyond the declared ones, kept in `payload`. */
export const MAX_EXTRA_KEYS = 20;

/** One request, from the first byte to the last byte of the answer. */
export const HTTP_TIMEOUT = 10_000;
/** Zapier answers a few hundred bytes; anything larger is not read. */
export const MAX_ANSWER_BYTES = 16 * 1024;
/**
 * Scene action budget: the manifest's timeout_seconds (45 s) counts from the
 * moment the scene reaches the action, Gladys' own wait for the connection
 * (up to 15 s) included: 25 s here leave that room.
 */
export const SCENE_BUDGET = 25_000;
/** Button budget, from the click: under the manifest's timeout_seconds (20 s). */
export const BUTTON_BUDGET = 18_000;
/** Sends in the queue, the one in flight included (one request at a time). */
export const MAX_QUEUE = 10;

/** Pause after a 429 or a 5xx: Retry-After when given, bounded, growing on repeat. */
export const PAUSE_MIN = 60_000;
export const PAUSE_MAX = 6 * 60 * 60_000;

/** /data: a read taking longer counts as unreadable (read again every 10 s). */
export const LOAD_TIMEOUT = 3_000;
export const STORE_RETRY = 10_000;
export const SAVE_TIMEOUT = 3_000;
export const STATUS_TIMEOUT = 4_000;
export const WEBHOOKS_TIMEOUT = 4_000;
export const MAX_STATE_BYTES = 128 * 1024;
/** Sends remembered for the caps (beyond, the oldest are merged). */
export const MAX_CALLS_KEPT = 1000;

/** What a request needs before the deadline: the save before it, the request, a margin. */
export const SEND_MARGIN = HTTP_TIMEOUT + SAVE_TIMEOUT + 500;
