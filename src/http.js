// -----------------------------------------------------------------------------
// The only network code: one HTTPS POST to a Zapier Catch Hook, with a
// timeout, the module's User-Agent, `Accept: application/json`, no redirect
// followed, and an answer read up to a bound. Taken from gladys-deepl
// (approved, same author).
//
// Every failure says whether Zapier may have started the Zap (`sent`):
//   - 'no'    : nothing was taken (a 4xx, a 429, a redirect, a name or
//               connection refused before the request left);
//   - 'maybe' : the request may have reached Zapier (a timeout, a connection
//               cut, a 5xx). Such a send is never tried again: a second try
//               could run the Zap, and use a task, a second time.
// The hook URL is a secret: no message here ever contains it, nor the body,
// nor what Zapier answered word for word.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_ANSWER_BYTES, USER_AGENT } from './constants.js';

export class ZapierError extends Error {
  /**
   * `code`: 'gone' (404, 410: Zapier knows no such hook), 'forbidden' (401,
   * 403: never taken as a refusal of the hook), 'invalid' (400, 422),
   * 'request_too_large' (413), 'rate_limited' (429), 'server' (5xx), 'http'
   * (other status), 'redirect', 'timeout', 'network', 'too_large'.
   */
  constructor(code, { status, sent = 'no', retryAfter } = {}) {
    super(status ? `Zapier answered ${status} (${code})` : `Zapier request failed (${code})`);
    this.name = 'ZapierError';
    this.code = code;
    this.status = status;
    this.sent = sent;
    this.retryAfter = retryAfter;
  }
}

/** Connection failures that happen before the request is written: nothing left. */
const BEFORE_SENDING =
  /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|UND_ERR_CONNECT_TIMEOUT|ERR_TLS_|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_SSL_)/;

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now) {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  if (!/^[A-Za-z]{3}, /.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The body as text, refused past `limit` bytes (read in chunks, never whole). */
export async function readBounded(response, limit) {
  const tooLarge = () => new ZapierError('too_large', { status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(err, sentIfUnknown) {
  if (err instanceof ZapierError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new ZapierError('timeout', { sent: sentIfUnknown });
  }
  const code = String(err?.cause?.code ?? err?.code ?? '');
  return new ZapierError('network', { sent: BEFORE_SENDING.test(code) ? 'no' : sentIfUnknown });
}

/**
 * One POST of `body` (an object, sent as JSON) to the hook `url`. Resolves
 * `{ status, json }` (json undefined when a 2xx body does not read); throws a
 * ZapierError otherwise.
 */
export async function postHook(
  url,
  body,
  {
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeout = HTTP_TIMEOUT,
    limit = MAX_ANSWER_BYTES,
  } = {},
) {
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
      redirect: 'manual',
    });
  } catch (err) {
    throw failure(err, 'maybe');
  }
  const { status } = response;
  if (status >= 200 && status < 300) {
    // Answered: a body that does not read is told by the caller (json undefined).
    let json;
    try {
      json = JSON.parse(await readBounded(response, limit));
    } catch {
      json = undefined;
    }
    return { status, json };
  }
  // The error body is never read: its free text is not shown, and not needed.
  await response.body?.cancel?.().catch(() => {});
  if (status >= 300 && status < 400) throw new ZapierError('redirect', { status });
  if (status === 404 || status === 410) throw new ZapierError('gone', { status });
  if (status === 401 || status === 403) throw new ZapierError('forbidden', { status });
  if (status === 413) throw new ZapierError('request_too_large', { status });
  if (status === 400 || status === 422) throw new ZapierError('invalid', { status });
  const served = Date.parse(response.headers?.get?.('date') ?? '');
  const retryAfter = () =>
    retryAfterMs(response.headers?.get?.('retry-after'), Number.isFinite(served) ? served : now());
  if (status === 429) throw new ZapierError('rate_limited', { status, retryAfter: retryAfter() });
  // A 5xx: Zapier may have taken the request before failing.
  if (status >= 500) {
    throw new ZapierError('server', { status, sent: 'maybe', retryAfter: retryAfter() });
  }
  throw new ZapierError('http', { status });
}
