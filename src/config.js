// -----------------------------------------------------------------------------
// The configuration typed in Gladys, read strictly. An option out of its
// bounds is brought back inside them; an empty or unreadable one takes its
// default. What is wrong is said by a code (`issues`), never by echoing the
// value: a Catch Hook URL is a secret (whoever has it can start the Zap).
// -----------------------------------------------------------------------------

import { BOUNDS, CONFIG, DEFAULTS, HOOK_URL } from './constants.js';

/** A strict integer option: '' or text = the default; a decimal refused; bounded. */
export function integerOption(raw, key) {
  const [min, max] = BOUNDS[key];
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULTS[key];
  return Math.min(max, Math.max(min, n));
}

/**
 * A Catch Hook URL: `{ url, zaps }` (`zaps`: the Zaps it starts, each a task),
 * `undefined` when empty, `null` when it does not read as a Zapier hook.
 */
export function parseHook(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return undefined;
  const match = HOOK_URL.exec(text);
  if (!match) return null;
  return { url: text.endsWith('/') ? text : `${text}/`, zaps: match[2].split(',').length };
}

/** Printable ASCII, 8 to 200 characters, no space: compared as typed. */
export const validSecret = (s) => typeof s === 'string' && /^[\x21-\x7e]{8,200}$/.test(s);

export function normalizeConfig(raw = {}) {
  const issues = [];
  const hooks = {};
  CONFIG.HOOKS.forEach((key, i) => {
    const hook = parseHook(raw[key]);
    if (hook === null) issues.push(`bad_hook_${i + 1}`);
    else if (hook) hooks[String(i + 1)] = hook;
  });
  const secretRaw =
    typeof raw[CONFIG.INBOUND_SECRET] === 'string' ? raw[CONFIG.INBOUND_SECRET].trim() : '';
  let inboundSecret = '';
  if (secretRaw) {
    if (validSecret(secretRaw)) inboundSecret = secretRaw;
    else issues.push('bad_secret');
  }
  return {
    hooks,
    maxPerDay: integerOption(raw[CONFIG.MAX_PER_DAY], CONFIG.MAX_PER_DAY),
    maxPerMonth: integerOption(raw[CONFIG.MAX_PER_MONTH], CONFIG.MAX_PER_MONTH),
    inboundSecret,
    /** A secret typed but unreadable: every inbound request is refused (never accepted without it). */
    inboundLocked: issues.includes('bad_secret'),
    issues,
  };
}
