import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHook, validSecret } from '../src/config.js';

test('Catch Hook URLs: the documented form only, several Zaps joined by commas', () => {
  assert.deepEqual(parseHook('https://hooks.zapier.com/hooks/catch/123456/zbB61/'), {
    url: 'https://hooks.zapier.com/hooks/catch/123456/zbB61/',
    zaps: 1,
  });
  assert.deepEqual(parseHook('  https://hooks.zapier.com/hooks/catch/123456/zbB61  '), {
    url: 'https://hooks.zapier.com/hooks/catch/123456/zbB61/',
    zaps: 1,
  });
  assert.equal(parseHook('https://hooks.zapier.com/hooks/catch/1/a,b,c/').zaps, 3);
  assert.equal(parseHook(''), undefined);
  assert.equal(parseHook(undefined), undefined);
  for (const bad of [
    'https://hooks.zapier.com/hooks/catch/123/',
    'https://hooks.zapier.com/hooks/catch/abc/def/',
    'https://hooks.zapier.com/hooks/catch/1/a,/',
    'https://hooks.zapier.com/hooks/catch/1/a/b/',
    'https://hooks.zapier.com:8443/hooks/catch/1/a/',
    'https://user@hooks.zapier.com/hooks/catch/1/a/',
    'https://hooks.zapier.com/hooks/catch/1/a/#x',
    'https://hooks.zapier.com/hooks/catch/1/a/\r\nX: y',
    'HTTPS://HOOKS.ZAPIER.COM/hooks/catch/1/a/',
    'https://hooks.zapier.com/hooks/catch/1/' + 'a,'.repeat(10) + 'a/',
    42,
  ]) {
    assert.equal(parseHook(bad), null, String(bad));
  }
});

test('options: strict integers, bounded, defaults; issues by code only', () => {
  const c = normalizeConfig({
    hook_1: 'https://hooks.zapier.com/hooks/catch/1/a/',
    hook_2: 'nope',
    max_sends_per_day: '2.5',
    max_sends_per_month: 999999,
  });
  assert.deepEqual(Object.keys(c.hooks), ['1']);
  assert.deepEqual(c.issues, ['bad_hook_2']);
  assert.equal(c.maxPerDay, 20);
  assert.equal(c.maxPerMonth, 50000);
  assert.equal(normalizeConfig({ max_sends_per_day: '' }).maxPerDay, 20);
  assert.equal(normalizeConfig({ max_sends_per_day: 0 }).maxPerDay, 1);
  assert.equal(normalizeConfig({ max_sends_per_day: ' 7 ' }).maxPerDay, 7);
  assert.equal(normalizeConfig({ max_sends_per_day: 'abc' }).maxPerDay, 20);
  assert.equal(normalizeConfig({ max_sends_per_day: null }).maxPerDay, 20);
  assert.ok(!JSON.stringify(c).includes('nope'));
});

test('the inbound secret: printable, 8 to 200, else locked', () => {
  assert.ok(validSecret('abcdefgh'));
  for (const bad of ['short', 'with space 123', 'accentué-12', 'x'.repeat(201), 'a\nbcdefghi']) {
    assert.ok(!validSecret(bad), bad);
    const c = normalizeConfig({ inbound_secret: bad });
    assert.equal(c.inboundLocked, true, bad);
    assert.equal(c.inboundSecret, '');
  }
  const ok = normalizeConfig({ inbound_secret: '  abcdefgh  ' });
  assert.equal(ok.inboundSecret, 'abcdefgh');
  assert.equal(ok.inboundLocked, false);
  assert.equal(normalizeConfig({}).inboundLocked, false);
});
