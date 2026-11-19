# TODO

## Before announcing

- [ ] Test with a real paid Zapier account: a Zap on "Webhooks by Zapier" → "Catch Hook", the test
      button, both scene actions with their outputs read by the next action, a hook joining two
      Zaps with a comma, a deleted Zap (404 or 410?).
- [ ] Test the events from Zapier on a real Gladys 5.3+ with Gladys Plus: a Zap with
      "Webhooks by Zapier" → "POST" (Payload Type json), with and without the shared secret, the
      trigger filtered on the event name.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store (after the first
      release: the store validator needs the GHCR image).
- [ ] Store field left out of the manifest: `keywords` (Zapier, webhook, Zap, automatisation,
      automation, no-code).

## To confirm

- [ ] What a Catch Hook answers for a Zap turned off, and for a deleted one (the module takes 404
      and 410 as "no such hook").
- [ ] Whether Zapier answers 429 with a Retry-After (the module handles both).
- [ ] The `request_id` field of the answer (`{ id, request_id, attempt, status }` as documented by
      examples; an unexpected value gives an empty output, the send still counts).
- [ ] How the Gladys Plus relay passes a form body and the query string (the parser takes JSON,
      form and query, and an already parsed object).

## Ideas

- A dashboard widget with a button sending to a Zap.
- A `sync` webhook answering the Zap with outputs of a scene.
- A cap per Zap.

## Decisions

- **Version 0.1.0** set once by hand when leaving the template (package, lock file, manifest,
  image tag `ghcr.io/lm1lc3n7/gladys-zapier:0.1.0`, User-Agent in `src/constants.js`); the Release
  workflow owns it from now on.
- **`type: "provider"`, `gladys_version: ">=5.1.0"`, worldwide**, categories `services` and
  `notifications`: scene actions, a scene trigger, a button and a webhook, no device. SDK ^0.16.0,
  the latest on 2026-11-15.
- **Reference**: the public Zapier help only; no Zapier library (none needed for one POST).
  Structure taken from gladys-deepl (approved: caps counted and saved before the request, no
  retry, `/data` unreadable ≠ empty).
- **Three Catch Hook slots**, all optional (receive only is possible with Gladys Plus). Strict URL
  form `https://hooks.zapier.com/hooks/catch/<digits>/<letters and digits, commas>/`: anything
  else is refused, never echoed. A hook joining N Zaps counts N runs per send. The caps count Zap runs, not tasks (Zapier
  bills a task per action step): the docs say to divide the plan by the action steps.
- **Caps**: tasks over a rolling 24 hours (1 to 2000, 20 by default) and a rolling 30 days (1 to
  50000, 500 by default), plus 10
  requests per minute (given back or not), and a pause doubled from 60 s after 3 refusals (4xx,
  redirect) in a row. Rolling windows on the monotonic clock, dated by the wall clock in `/data`
  only (a clock set back keeps the count longer, never shorter).
- **No retry**, ever: a timeout, a cut connection or a 5xx may have run the Zap. A 4xx, a 429, a
  redirect (never followed), a refused name or connection give the task back.
- **Refused hook**: 404/410 only; kept as an 8-bit salted HMAC in `/data`; a new URL typed during
  the run is always tried; the test button may retry a refused hook (a click) and its success
  lifts it. A new URL typed while stopped sharing the mark (1 in 256) needs the button (docs).
  401/403 are not a refusal.
- **Loop guard**: the module never sends because of an event received, and never fires the
  trigger because of an action. For the loops a user can build (trigger → send → Zap → Gladys), a
  send leaving less than 15 s after an event received is "reactive"; a fourth reactive send within
  5 minutes is refused and every send stops for 30 minutes (kept in `/data`), lifted by saving the
  configuration. Up to 3 runs per Zap of the hook are lost before the stop; a scene that waits
  15 s or more escapes the guard (only the caps stop it), said in the docs. Not a pause on every send after an event: a
  scene may answer a Zap once.
- **Inbound**: `fire_and_forget`; JSON, form or query; keys kept in a `Map` (no prototype
  pollution); body ≤ 64 KB, values cut at 1000 characters (the core's limit for an event; the
  sends refuse instead of cutting); other keys in `payload` (20 at most, a key that would pass 1000 characters left out so the
  JSON always parses). The per-minute bound counts accepted events only; refusals are logged once
  per minute. Optional shared secret
  (8 to 200 printable characters) compared in constant time; a secret that does not read refuses
  every event (never accepts without it). 60 events per minute at most. The Gladys Plus URL is
  never shown by the module (the core's block shows it).
- **Status**: connected when at least one usable hook exists, or receive only with Gladys Plus;
  shows the Zap runs counted over both windows, the Gladys Plus state, refused hooks, pauses.
- **Button budget** 18 s from the click, scene budget 25 s (manifest 45 s, Gladys' 15 s wait for
  the connection included); one request at a time, a queue of 10.
