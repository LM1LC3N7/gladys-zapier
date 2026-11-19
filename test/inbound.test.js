import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, inboundEvent, parseRequest, sameSecret } from '../src/inbound.js';

const post = (body) => ({ body: JSON.stringify(body), contentType: 'application/json' });

test('JSON, form, query, plain text', () => {
  assert.equal(parseRequest(post({ event: 'a' })).get('event'), 'a');
  assert.equal(parseRequest({ body: 'event=b&value1=x' }).get('event'), 'b');
  assert.equal(parseRequest({ query: { event: 'c' } }).get('event'), 'c');
  const text = parseRequest({ body: 'hello', contentType: 'text/plain', query: { event: 'd' } });
  assert.equal(text.get('value1'), 'hello');
  assert.equal(parseRequest({ body: { event: 'e' } }).get('event'), 'e', 'an object body');
  assert.equal(parseRequest({ body: '{broken', contentType: 'application/json' }).size, 0);
});

test('values: strings of 1000 characters at most, null when absent', () => {
  assert.equal(clip(undefined), null);
  assert.equal(clip(null), null);
  assert.equal(clip(3), '3');
  assert.equal(clip(false), 'false');
  assert.equal(clip({ a: 1 }), '{"a":1}');
  assert.equal(clip('x'.repeat(2000)).length, 1000);
  const r = inboundEvent(post({ event: 'a', value3: 'x'.repeat(5000) }));
  assert.equal(r.data.value3.length, 1000);
  assert.equal(r.data.value1, null);
});

test('payload: other keys, 20 at most, "__proto__" a plain key', () => {
  const body = '{"event":"a","__proto__":{"polluted":1},"k":"v"}';
  const r = inboundEvent({ body, contentType: 'application/json' });
  assert.equal(r.ok, true);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(JSON.parse(r.data.payload), { ['__proto__']: { polluted: 1 }, k: 'v' });
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
  const m = inboundEvent(post({ event: 'a', ...many }));
  assert.equal(Object.keys(JSON.parse(m.data.payload)).length, 20);
  // 30 keys of 80 characters: the JSON still parses, the keys that do not fit are left out.
  const wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v'.repeat(80)]));
  const w = inboundEvent(post({ event: 'a', ...wide }));
  assert.ok(w.data.payload.length <= 1000);
  const parsed = JSON.parse(w.data.payload);
  assert.ok(Object.keys(parsed).length >= 10);
  for (const value of Object.values(parsed)) assert.equal(value, 'v'.repeat(80), 'never cut');
  assert.equal(inboundEvent(post({ event: 'a' })).data.payload, null);
  assert.ok(!inboundEvent(post({ event: 'a', secret: 's' })).data.payload);
});

test('refusals: no event, a bad name, a large body, the secret', () => {
  assert.deepEqual(inboundEvent(post({})), { ok: false, reason: 'no_event' });
  assert.deepEqual(inboundEvent(post({ event: 'a b' })), { ok: false, reason: 'no_event' });
  assert.deepEqual(inboundEvent(post({ event: 'x'.repeat(65) })), {
    ok: false,
    reason: 'no_event',
  });
  assert.deepEqual(inboundEvent(post({ event: 5 })), { ok: false, reason: 'no_event' });
  assert.deepEqual(inboundEvent({ body: 'x'.repeat(70_000) }), { ok: false, reason: 'too_large' });
  const secret = 'abcdefgh';
  assert.equal(inboundEvent(post({ event: 'a' }), { secret }).reason, 'bad_secret');
  assert.equal(
    inboundEvent(post({ event: 'a', secret: 'abcdefgH' }), { secret }).reason,
    'bad_secret',
  );
  assert.equal(
    inboundEvent(post({ event: 'a', secret: ['abcdefgh'] }), { secret }).reason,
    'bad_secret',
  );
  assert.equal(inboundEvent(post({ event: 'a', secret }), { secret }).ok, true);
  assert.equal(
    inboundEvent(post({ event: 'a', secret }), { locked: true }).reason,
    'secret_unreadable',
  );
  assert.equal(sameSecret('', ''), false);
});
