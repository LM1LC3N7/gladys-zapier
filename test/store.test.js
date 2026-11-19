import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/store.js';

async function dir(t) {
  const d = await mkdtemp(join(tmpdir(), 'zapier-store-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}

test('a missing file is "missing"; a saved state reads back', async (t) => {
  const file = join(await dir(t), 'state.json');
  const store = createFileStore(file);
  assert.deepEqual(await store.load(), { status: 'missing' });
  await store.save({ calls: [{ wall: 1, n: 12 }] });
  assert.deepEqual(await store.load(), { status: 'ok', data: { calls: [{ wall: 1, n: 12 }] } });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { calls: [{ wall: 1, n: 12 }] });
});

test('unreadable is never "missing": not a file, too large, not JSON, not an object', async (t) => {
  const d = await dir(t);
  const cases = {
    'a-directory.json': async (f) => mkdir(f),
    'too-large.json': async (f) => writeFile(f, JSON.stringify({ pad: 'x'.repeat(140 * 1024) })),
    'broken.json': async (f) => writeFile(f, '{"calls": ['),
    'null.json': async (f) => writeFile(f, 'null'),
    'array.json': async (f) => writeFile(f, '[]'),
    'number.json': async (f) => writeFile(f, '42'),
  };
  for (const [name, make] of Object.entries(cases)) {
    const file = join(d, name);
    await make(file);
    assert.deepEqual(await createFileStore(file).load(), { status: 'unreadable' }, name);
  }
  if (process.getuid?.() !== 0) {
    const file = join(d, 'no-access.json');
    await writeFile(file, '{}', { mode: 0o000 });
    assert.deepEqual(await createFileStore(file).load(), { status: 'unreadable' }, 'EACCES');
  }
});

test('saves are written one at a time, and only the newest waits behind a hung write', async () => {
  const written = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const store = createFileStore('/nowhere', {
    writeImpl: async (data) => {
      written.push(data.n);
      if (written.length === 1) await gate;
    },
  });
  const saves = [];
  for (let n = 0; n < 50; n += 1) saves.push(store.save({ n }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(written, [0], 'one write in flight, nothing queued behind it yet');
  release();
  await Promise.all(saves);
  assert.deepEqual(written, [0, 49], 'the 48 snapshots in between are replaced by the last');
});

test('a failed write rejects its savers and does not stop the next one', async () => {
  let fail = true;
  const store = createFileStore('/nowhere', {
    writeImpl: async () => {
      if (fail) throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
    },
  });
  await assert.rejects(store.save({ n: 1 }), { code: 'EROFS' });
  fail = false;
  await store.save({ n: 2 });
});
