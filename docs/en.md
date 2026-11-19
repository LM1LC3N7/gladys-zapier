# Zapier for Gladys Assistant

Unofficial integration, not affiliated with Zapier. It has never been tested with a real Zapier
account yet: please report how it goes.

## What it does

- **From Gladys to Zapier**: the scene actions **Send to a Zap** and **Send JSON to a Zap** post an
  event to the _Catch Hook_ URL of a Zap. The Zap then runs with the fields `event`, `value1`,
  `value2`, `value3` (or the keys of your JSON object), `source` (`gladys`) and `sent_at` (ISO date).
- **From Zapier to Gladys** (needs **Gladys Plus**): a Zap posts to the Gladys Plus URL of the
  integration, and your scenes start on the trigger **Event received from Zapier**, with the
  variables `event`, `value1`, `value2`, `value3` and `payload` (the other fields, as JSON).

Zapier is called only by the two scene actions and the **Send a test event** button: never at
start, never on a timer, never because an event was received.

## Costs: Zapier tasks and Zap runs

"Webhooks by Zapier" is a premium app: it needs a paid Zapier plan. **Each send runs the Zap and
uses one Zapier task per action step that runs**: a Zap with 3 action steps uses 3 tasks. The
module counts **Zap runs** (one per Zap started), not tasks, and refuses a send beyond its caps:
divide the tasks of your plan by the action steps of your Zaps.

- **Maximum Zap runs over 24 hours** (1 to 2000, 20 by default);
- **Maximum Zap runs over 30 days** (1 to 50000, 500 by default): a rolling 30 days, not your Zapier
  billing month; set it below the tasks of your plan divided by the action steps, minus what
  your other Zaps use;
- at most **10 requests per minute**, whatever the caps, answered or not (a request Zapier refused
  counts here even when its run is given back);
- from the **third refusal in a row** (a 4xx answer or a redirect), a pause of 60 s, doubled at each
  new refusal, 6 h at most, lifted by a send Zapier accepts.

A send is counted, and the count saved in `/data`, **before** its request leaves (no save, no
request), so the count survives a restart. It is given back only when Zapier surely did not take it
(a 4xx answer, a 429, a redirect, a name or connection refused). A send without a clear answer (a
timeout, a cut connection, a 5xx) stays counted and is **not tried again**: a second try could run
the Zap twice. The module counts its own sends only; your Zapier dashboard shows the real tasks.

## Set up the sends to Zapier

1. In Zapier, create a Zap whose trigger is **Webhooks by Zapier** → **Catch Hook**.
2. Copy the URL Zapier shows (`https://hooks.zapier.com/hooks/catch/<account>/<hook>/`) into
   **Catch Hook URL 1** of the integration configuration (up to three Zaps: URLs 2 and 3). Zapier
   documents joining the hooks of several Zaps of the same account with commas
   (`…/catch/123456/zbB61,kzXC4/`): each Zap named runs and counts as one run.
3. Click **Send a test event**: the event `gladys_test` (with `test: true`) reaches the Zap, and
   counts as a run. Then build the rest of the Zap with its fields.
4. In a scene, add **Send to a Zap**: choose the Catch Hook, an event name (1 to 64 letters, digits,
   `_`, `-`, `.`) and up to three values (1000 characters each at most, never cut: a longer value
   refuses the send). Outputs for the next actions: `request_id` (Zapier's) and `zap_runs`.

**The Catch Hook URL is a secret**: whoever has it can start the Zap. It is kept by Gladys in its
database, never shown again, sent only to `hooks.zapier.com`, and never written in the logs, the
status or `/data`. A URL that is not a Zapier Catch Hook URL is refused (and never shown back).

## Set up the events from Zapier (Gladys Plus)

Without Gladys Plus, only the sends to Zapier work; the status of the integration says so.

1. Link Gladys Plus and paste your Open API key in the **Gladys Plus webhooks** block of the
   integration configuration: Gladys shows the public URL of the webhook **Events from Zapier**.
   This URL is a secret too.
2. In a Zap, add the action **Webhooks by Zapier** → **POST**, URL = that Gladys Plus URL,
   _Payload Type_ `json`, _Data_: `event` = your event name, and `value1`, `value2`, `value3` as you
   wish. Other keys go into `payload`, a JSON object of 20 keys and 1000 characters at most: a key that
   does not fit is left out, never cut.
3. Optional: type a **shared secret** (8 to 200 characters, no space) in the configuration, and add a
   `secret` field with the same value in the Zap: an event without it is ignored. A secret that does
   not read refuses every event.
4. In a scene, use the trigger **Event received from Zapier**, filtered on the event name or not.

The module publishes at most 60 events per minute and ignores a body larger than 64 KB.

## Loops

An event received never sends anything to Zapier. But a scene started by **Event received from
Zapier** that sends to a Zap which calls Gladys again would loop and use tasks. The module watches
the sends a scene calls less than 15 s after an event received: **after 3 of them within 5
minutes, the next one is refused and every send stops for 30 minutes** (kept across a restart).
Its limits: a scene that waits 15 s or more before sending escapes the guard, and only the caps
stop such a loop; a hook joining several Zaps loses up to 3 runs per Zap before the stop. Fix the
scene, then save the configuration to resume at once.

## Pauses and refusals

- **429** (Zapier asks to slow down): no send for its `Retry-After`, 60 s to 6 h.
- **5xx**: no send for 60 s, doubled at each new failure, 6 h at most.
- **404 or 410** (Zapier knows no such hook: Zap deleted, or URL changed): the scenes stop using
  this hook. Its 8-bit fingerprint is kept in `/data`; pasting another URL lifts it, and so does a
  success of the test button. A new URL typed while the integration was stopped shares that
  fingerprint once in 256: then click the test button.
- **401/403** are not taken as a refusal of the hook.
- `/data` unreadable: nothing is sent (the runs counted are unknown); read again every 10 s, never
  overwritten.
