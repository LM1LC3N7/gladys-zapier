// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Zapier and a virtual
// clock (each read moves it 1 µs).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../../src/app.js';
import { ACTIONS, HOOK_ORIGIN, SCENE_ACTIONS, WEBHOOKS } from '../../src/constants.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from './clock.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const NOW = Date.parse('2026-11-15T09:00:00Z');
export const HOOK1 = 'https://hooks.zapier.com/hooks/catch/123456/SECRETHOOKa1/';
export const HOOK2 = 'https://hooks.zapier.com/hooks/catch/123456/SECRETHOOKb2,SECRETHOOKc3/';
export const HOOK3 = 'https://hooks.zapier.com/hooks/catch/654321/SECRETHOOKd4';
export const SECRET = 'SECRET-inbound-777';
export const PLUS_URL = 'https://api.gladysgateway.com/v1/webhook/SECRETPLUSURL';

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A fetch failure like undici's: `code` on the cause, or a timeout. */
export function fetchError(kind) {
  if (kind === 'timeout') {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    return err;
  }
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(kind), { code: kind });
  return err;
}

/**
 * Zapier: `api.handler(request)` returns a Response, or a string naming a
 * failure ('timeout', 'ECONNRESET', 'ENOTFOUND'…); none = success.
 */
export function createApi() {
  const api = { requests: [], handler: undefined, inFlight: 0, peak: 0 };
  api.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const request = {
      url: String(url),
      path: u.pathname,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
      init,
    };
    api.requests.push(request);
    api.inFlight += 1;
    api.peak = Math.max(api.peak, api.inFlight);
    try {
      if (u.origin !== HOOK_ORIGIN) return new Response('nope', { status: 404 });
      const out = api.handler ? await api.handler(request) : undefined;
      if (typeof out === 'string') throw fetchError(out);
      if (out instanceof Response) return out;
      return json({
        attempt: 'a1',
        id: 'id-1',
        request_id: `req-${api.requests.length}`,
        status: 'success',
      });
    } finally {
      api.inFlight -= 1;
    }
  };
  return api;
}

export const BASE_CONFIG = { hook_1: HOOK1 };
export const FIELDS = { zap: '1', event: 'door_opened', value1: 'PRIVATE-VALUE' };
export const PLUS = {
  available: true,
  webhooks: [{ key: WEBHOOKS.INBOUND, mode: 'fire_and_forget', url: PLUS_URL }],
};

export async function setup({
  config = BASE_CONFIG,
  store = createMemoryStore(),
  now = NOW,
  start = true,
  handler,
  getConfig,
  webhooks = PLUS,
  clock = testClock({ start: now }),
} = {}) {
  const gladys = createFakeGladys({ selector: 'zapier', config, webhooks });
  if (getConfig) gladys.getConfig = getConfig;
  const api = createApi();
  api.handler = handler;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  let random = 0;
  const app = new App({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    fetchImpl: api.fetch,
    random: (n) => String((random += 1)).padStart(n * 2, 'a'),
  });
  gladys.onSceneAction(SCENE_ACTIONS.SEND, (fields) => app.sceneSend(fields, false));
  gladys.onSceneAction(SCENE_ACTIONS.SEND_JSON, (fields) => app.sceneSend(fields, true));
  gladys.onAction(ACTIONS.TEST, (fields) => app.sendTest(fields));
  gladys.onWebhook(WEBHOOKS.INBOUND, (request) => app.handleInbound(request));
  gladys.onWebhookUpdated(async (info) => app.applyWebhooks(info));
  gladys.onConfigUpdated(async (c) => app.configUpdated(c));
  gladys.on('connected', () => app.connected());
  const wait = async (ms) => {
    await clock.advance(ms);
    await app.idle();
  };
  /** Time going by in small steps: a request's timer set after a step is still met. */
  const run = async (ms, step = 100) => {
    for (let t = 0; t < ms; t += step) await clock.advance(step);
  };
  if (start) {
    await gladys.connect();
    await wait(0);
  }
  /** The scene action, as Gladys runs it: resolves the ack. */
  const scene = (fields = FIELDS, key = SCENE_ACTIONS.SEND) => gladys.fake.sceneAction(key, fields);
  /** An event posted by a Zap through Gladys Plus. */
  const inbound = async (body, extra = {}) => {
    await gladys.fake.webhook(WEBHOOKS.INBOUND, {
      method: 'POST',
      contentType: 'application/json',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      query: {},
      ...extra,
    });
    await settle(20);
    await app.idle();
  };
  return { app, gladys, clock, store, api, wait, run, lines, scene, inbound };
}

/** Everything the module wrote outside the API: logs, statuses, /data. */
export function leaked({ lines, gladys, store }) {
  return [
    ...lines,
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(store.data ?? {}),
  ].join('\n');
}

/** The last status published. */
export const lastStatus = (gladys) => gladys.fake.connectionStatuses.at(-1);
