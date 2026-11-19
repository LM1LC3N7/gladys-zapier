// -----------------------------------------------------------------------------
// The real clock (performance.now, setTimeout) sped up, and a real local HTTP
// server standing for Zapier: the pause after a 5xx lasts 60 s, the daily cap
// frees its tasks 24 hours after the send, never sooner, the loop pause lasts
// 30 min; nothing leaves after stop. Wide margins: a timer is late under
// load, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../src/app.js';
import { HOOK_ORIGIN } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { realClock } from './helpers/clock.js';

const HOOK = 'https://hooks.zapier.com/hooks/catch/1/abc/';

async function bench(t, { speed, status = () => 200, config }) {
  const clock = realClock({ speed });
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ at: clock.monotonic(), ua: req.headers['user-agent'], body });
      const code = status(requests.length);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(code === 200 ? { status: 'success', request_id: 'r' } : {}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gladys = createFakeGladys({ selector: 'zapier', config });
  const app = new App({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    fetchImpl: (url, init) =>
      fetch(String(url).replace(HOOK_ORIGIN, base), {
        ...init,
        signal: AbortSignal.timeout(5000),
      }),
  });
  gladys.on('connected', () => app.connected());
  t.after(async () => {
    await app.stop();
    clock.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  await gladys.connect();
  await app.idle();
  return { app, clock, requests };
}

const FIELDS = { zap: '1', event: 'tick' };
// A wide budget: at 10,000 times real speed, one real millisecond of load is
// 10 simulated seconds, and the scene budget (25 s) would run out.
const BUDGET = 3_600_000;

/** Tries a send every `step` simulated ms until one succeeds; resolves its time. */
async function firstSuccess({ app, clock }, step, limit) {
  const start = clock.monotonic();
  while (clock.monotonic() - start < limit) {
    const at = clock.monotonic();
    const out = await app.send(FIELDS, { budget: BUDGET }).catch(() => undefined);
    if (out) return at;
    await clock.sleep(step);
  }
  throw new Error('never sent');
}

test('real clock: the pause after a 5xx lasts 60 s, never less', async (t) => {
  const b = await bench(t, {
    speed: 100,
    status: (n) => (n === 1 ? 503 : 200),
    config: { hook_1: HOOK },
  });
  await b.app.send(FIELDS, { budget: BUDGET }).catch(() => {});
  const failedAt = b.requests[0].at;
  const at = await firstSuccess(b, 2_000, 200_000);
  const gap = at - failedAt;
  assert.ok(gap >= 60_000 && gap <= 90_000, `pause of ${Math.round(gap)} ms`);
  assert.equal(b.requests.length, 2, 'no request during the pause');
  assert.match(b.requests[0].ua, /^gladys-zapier\//);
});

test('real clock: the daily cap frees a task 24 hours later; nothing after stop', async (t) => {
  const b = await bench(t, {
    speed: 10_000,
    config: { hook_1: HOOK, max_sends_per_day: 5 },
  });
  const sentAt = b.clock.monotonic();
  for (let i = 0; i < 5; i += 1) await b.app.send(FIELDS, { budget: BUDGET });
  const at = await firstSuccess(b, 10 * 60_000, 30 * 60 * 60_000);
  const gap = at - sentAt;
  assert.ok(
    gap >= 24 * 60 * 60_000 && gap <= 26 * 60 * 60_000,
    `tasks freed after ${(gap / 3_600_000).toFixed(2)} h`,
  );
  assert.equal(b.requests.length, 6);
  await b.app.stop();
  const timers = b.clock.timersSet;
  await b.clock.sleep(2 * 60 * 60_000);
  assert.equal(b.requests.length, 6, 'no request after stop');
  assert.equal(b.clock.timersSet, timers, 'no timer after stop');
});

test('real clock: the loop pause lasts 30 min, never less', async (t) => {
  const b = await bench(t, { speed: 1000, config: { hook_1: HOOK, max_sends_per_day: 100 } });
  let stoppedAt;
  for (let i = 0; i < 4; i += 1) {
    await b.app.handleInbound({ body: '{"event":"ping"}' });
    stoppedAt = b.clock.monotonic();
    await b.app.send(FIELDS, { budget: BUDGET }).catch(() => {});
  }
  assert.equal(b.requests.length, 3);
  const at = await firstSuccess(b, 60_000, 60 * 60_000);
  const gap = at - stoppedAt;
  assert.ok(gap >= 30 * 60_000 && gap <= 36 * 60_000, `loop pause of ${Math.round(gap / 1000)} s`);
});
