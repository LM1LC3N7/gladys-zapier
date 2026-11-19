// -----------------------------------------------------------------------------
// A request relayed by Gladys Plus (a Zap's "Webhooks by Zapier: POST" action,
// or any HTTP client holding the URL) turned into the flat data of the
// `zap_received` scene trigger. Pure: no I/O, linear, bounded.
//
// Accepted shapes, read in this order (a later one wins on the same key):
//   - the query string (?event=...&value1=...);
//   - a JSON object body: { "event": "...", "value1": ..., "secret": "..." };
//   - a form body (application/x-www-form-urlencoded) with the same keys;
//   - any other text body is value1 (when the fields have none).
// Every other key is kept in `payload` (JSON, 20 keys at most). The keys are
// kept in a Map: a "__proto__" key is a key like any other.
// -----------------------------------------------------------------------------

import { createHash, timingSafeEqual } from 'node:crypto';
import { EVENT_NAME, MAX_EXTRA_KEYS, MAX_INBOUND_BYTES, MAX_VALUE } from './constants.js';

const RESERVED = new Set(['event', 'value1', 'value2', 'value3', 'secret']);
const MAX_KEY = 64;

/** A value as the scene receives it: a string of 1000 characters at most, or null. */
export function clip(value) {
  if (value === undefined || value === null) return null;
  let text;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      return null;
    }
  }
  if (typeof text !== 'string') return null;
  return text.length > MAX_VALUE ? text.slice(0, MAX_VALUE) : text;
}

function addAll(fields, entries) {
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || key.length > MAX_KEY) continue;
    fields.set(key, value);
  }
}

/** The fields carried by the request, or undefined when it is too large to read. */
export function parseRequest({ body, contentType, query } = {}) {
  const fields = new Map();
  if (query && typeof query === 'object' && !Array.isArray(query)) {
    addAll(fields, Object.entries(query).slice(0, 50));
  }
  let text = '';
  if (typeof body === 'string') text = body;
  else if (body && typeof body === 'object') {
    // A relay that already parsed the JSON body.
    try {
      text = JSON.stringify(body);
    } catch {
      text = '';
    }
  }
  if (Buffer.byteLength(text) > MAX_INBOUND_BYTES) return undefined;
  text = text.trim();
  if (!text) return fields;
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('json') || text.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      addAll(fields, Object.entries(parsed).slice(0, 50));
    }
  } else if (type.includes('x-www-form-urlencoded') || /^[\w%.+-]+=/.test(text)) {
    let n = 0;
    for (const entry of new URLSearchParams(text)) {
      if ((n += 1) > 50) break;
      addAll(fields, [entry]);
    }
  } else if (!fields.has('value1')) {
    fields.set('value1', text);
  }
  return fields;
}

const digest = (text) => createHash('sha256').update(String(text)).digest();

/** Compares the secret given with the expected one in constant time. */
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The scene event of a request, or a rejection:
 *   { ok: true, data }       -> publish `data`
 *   { ok: false, reason }    -> ignore (and log the reason only)
 */
export function inboundEvent(request, { secret = '', locked = false } = {}) {
  if (locked) return { ok: false, reason: 'secret_unreadable' };
  const fields = parseRequest(request);
  if (!fields) return { ok: false, reason: 'too_large' };
  if (secret && !sameSecret(fields.get('secret'), secret)) {
    return { ok: false, reason: 'bad_secret' };
  }
  const event = typeof fields.get('event') === 'string' ? fields.get('event').trim() : '';
  if (!EVENT_NAME.test(event)) return { ok: false, reason: 'no_event' };
  const extra = {};
  let kept = 0;
  for (const [key, value] of fields) {
    if (RESERVED.has(key)) continue;
    if (kept >= MAX_EXTRA_KEYS) break;
    Object.defineProperty(extra, key, { value, enumerable: true, writable: true });
    kept += 1;
  }
  return {
    ok: true,
    data: {
      event,
      value1: clip(fields.get('value1')),
      value2: clip(fields.get('value2')),
      value3: clip(fields.get('value3')),
      payload: kept > 0 ? clip(extra) : null,
    },
  };
}
