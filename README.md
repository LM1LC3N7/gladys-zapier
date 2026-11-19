# Zapier for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) integration, not affiliated with
Zapier, both ways:

- **to Zapier**: the scene actions **"Send to a Zap"** and **"Send JSON to a Zap"** post an event
  to the Catch Hook URL of a Zap ("Webhooks by Zapier", `hooks.zapier.com`), up to three Zaps;
- **from Zapier** (Gladys Plus): a Zap posts to the Gladys Plus webhook of the integration, and the
  scene trigger **"Event received from Zapier"** starts your scenes.

- Each send runs a Zap (Zapier bills a task per action step): caps of Zap runs in the module (over
  24 hours and over 30 days, 10 requests per minute), counted and saved in `/data` before each
  request, kept across a restart; a growing pause of one hook after 3 refusals (4xx) in a row from it.
- A send that may have been taken (timeout, cut connection, 5xx) is never tried again; pauses after
  a 429 or a 5xx; a hook Zapier does not know (404/410) is no longer used by scenes.
- An event received never sends anything. A loop built by a scene (event → send → Zap → Gladys) is
  stopped for 30 minutes after 3 quick rounds; a scene that waits 15 s or more escapes this guard,
  only the caps stop it.
- The Catch Hook URLs, the inbound secret and the values never reach the logs, the status nor
  `/data`.
- Never tested with a real Zapier account yet.

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Requirements

Gladys Assistant 5.1 or later (scene actions and triggers); a paid Zapier plan ("Webhooks by
Zapier" is a premium app); Gladys Plus for the events from Zapier only.

## Development

```bash
npm install
npm test             # node --test
npm run lint
npm run format:check
```

Node 22 or later, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
See `CLAUDE.md` for the architecture and the rules, `TODO.md` for the decisions and what remains
to check.

## Licence

Apache-2.0 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`). "Zapier" is a name of its owner, used only
to say which service is called.
