// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// dates and task counts of the sends of the last 30 days (for the caps across
// a restart), the pause after a 429, a 5xx or a probable loop, and the short
// fingerprints of the refused hooks. No hook URL, no event, no value. One
// JSON file written through a temporary file and a rename, one save after the
// other. Taken from gladys-deepl (approved).
//
// A missing file is an empty state; an unreadable one (permissions, a broken
// volume, a file too large or not ours) is told apart: the app reads it again
// later and never overwrites it with an empty state.
// -----------------------------------------------------------------------------

import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { MAX_STATE_BYTES } from './constants.js';

export const DEFAULT_STATE_FILE = '/data/zapier-state.json';

export function createFileStore(file = DEFAULT_STATE_FILE, { writeImpl } = {}) {
  // One write at a time, and at most ONE waiting behind it: a newer snapshot
  // replaces the waiting one (it holds everything the older one did), so a
  // write that hangs never piles the saves up.
  let writing = false;
  let next; // { data, promise, resolve, reject }
  const write =
    writeImpl ??
    (async (data) => {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(data), 'utf8');
      await rename(tmp, file);
    });
  async function pump() {
    writing = true;
    while (next) {
      const slot = next;
      next = undefined;
      try {
        await write(slot.data);
        slot.resolve();
      } catch (err) {
        slot.reject(err);
      }
    }
    writing = false;
  }
  return {
    /** `{ status: 'ok', data }`, `{ status: 'missing' }` or `{ status: 'unreadable' }`. */
    async load() {
      try {
        if ((await stat(file)).size > MAX_STATE_BYTES) return { status: 'unreadable' };
        const data = JSON.parse(await readFile(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data)
          ? { status: 'ok', data }
          : { status: 'unreadable' };
      } catch (err) {
        return err?.code === 'ENOENT' ? { status: 'missing' } : { status: 'unreadable' };
      }
    },
    save(data) {
      if (!next) {
        const slot = {};
        slot.promise = new Promise((resolve, reject) => Object.assign(slot, { resolve, reject }));
        slot.promise.catch(() => {});
        next = slot;
      }
      next.data = data;
      const { promise } = next;
      if (!writing) pump();
      return promise;
    },
  };
}

/** The same in memory (tests): `unreadable` and `failSave` simulate a broken volume. */
export function createMemoryStore(initial) {
  let data = initial === undefined ? undefined : structuredClone(initial);
  const store = {
    unreadable: false,
    failSave: false,
    saves: 0,
    async load() {
      if (store.unreadable) return { status: 'unreadable' };
      return data === undefined
        ? { status: 'missing' }
        : { status: 'ok', data: structuredClone(data) };
    },
    async save(next) {
      if (store.failSave) throw new Error('EROFS');
      store.saves += 1;
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
  return store;
}
