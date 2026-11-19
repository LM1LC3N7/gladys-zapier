import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZapierError, postHook, readBounded, retryAfterMs } from '../src/http.js';
import { HOOK1, fetchError, json } from './helpers/app.js';

const call = (out) =>
  postHook(
    HOOK1,
    { event: 'x' },
    {
      fetchImpl: async () => {
        if (typeof out === 'string') throw fetchError(out);
        return out;
      },
      now: () => Date.parse('2026-11-15T09:00:00Z'),
    },
  );

test('Retry-After: seconds or an HTTP date, nothing else', () => {
  const now = Date.parse('2026-11-15T09:00:00Z');
  assert.equal(retryAfterMs('120', now), 120_000);
  assert.equal(retryAfterMs('Sun, 15 Nov 2026 09:05:00 GMT', now), 300_000);
  for (const bad of [undefined, '', '-5', '1.5', '2026-11-15', 'x'.repeat(100)]) {
    assert.equal(retryAfterMs(bad, now), undefined, String(bad));
  }
});

test('a body larger than the bound is cut before being read whole', async () => {
  const declared = new Response('x', { headers: { 'content-length': '999999' } });
  await assert.rejects(readBounded(declared, 100), { code: 'too_large' });
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1000));
      if (pulled > 1000) controller.close();
    },
  });
  await assert.rejects(readBounded(new Response(stream), 5000), { code: 'too_large' });
  assert.ok(pulled < 20, `stopped early (${pulled} chunks)`);
});

test('each status says whether Zapier may have taken the send', async () => {
  for (const [out, code, sent] of [
    [json({}, 400), 'invalid', 'no'],
    [json({}, 401), 'forbidden', 'no'],
    [json({}, 403), 'forbidden', 'no'],
    [json({}, 404), 'gone', 'no'],
    [json({}, 410), 'gone', 'no'],
    [json({}, 413), 'request_too_large', 'no'],
    [json({}, 422), 'invalid', 'no'],
    [json({}, 418), 'http', 'no'],
    [json({}, 429), 'rate_limited', 'no'],
    [json({}, 500), 'server', 'maybe'],
    [json({}, 503), 'server', 'maybe'],
    [new Response(null, { status: 302 }), 'redirect', 'no'],
    ['timeout', 'timeout', 'maybe'],
    ['ECONNRESET', 'network', 'maybe'],
    ['ENOTFOUND', 'network', 'no'],
    ['ECONNREFUSED', 'network', 'no'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'network', 'no'],
  ]) {
    await assert.rejects(call(out), (err) => {
      assert.ok(err instanceof ZapierError);
      assert.equal(err.code, code, `${out.status ?? out}`);
      assert.equal(err.sent, sent, `${out.status ?? out}`);
      return true;
    });
  }
});

test('an error never carries the URL nor the free text of Zapier', async () => {
  for (const out of [json({ message: 'PRIVATE text' }, 400), 'ECONNRESET', 'timeout']) {
    await assert.rejects(call(out), (err) => {
      const text = JSON.stringify({ ...err, m: err.message });
      assert.ok(!text.includes('PRIVATE') && !text.includes('SECRETHOOK'), text);
      return true;
    });
  }
});

test('a 2xx: json, or undefined when the body does not read (still a success)', async () => {
  assert.deepEqual((await call(json({ request_id: 'r' }))).json, { request_id: 'r' });
  assert.equal((await call(new Response('ok', { status: 200 }))).json, undefined);
  const big = new Response('x'.repeat(40_000), { status: 200 });
  assert.equal((await call(big)).json, undefined);
});
