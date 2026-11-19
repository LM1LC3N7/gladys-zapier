# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "cap"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js            SDK wiring only: handlers registered before connect()
src/app.js          queue, guards (caps, pauses, loop guard, refused hooks), sends, inbound, /data, status
src/http.js         the only network code: timeout, User-Agent, bounded body, "may have been taken"
src/inbound.js      a Gladys Plus request -> the scene event data (pure, bounded, secret check)
src/config.js       strict reading of the configuration (Catch Hook URLs, caps, secret)
src/store.js        /data state file (missing vs unreadable, atomic write)
src/i18n.js         status, button and scene texts (en, fr)
src/constants.js    manifest keys, bounds, delays
scripts/mutants.mjs mutation check (scripts/mutants.json)
scripts/cover.mjs   cover.png
```

## Module rules

- Zapier is called only by the two scene actions and the "Send a test event"
  button: never at start, on a reconnection, on a configuration change, by a
  timer, nor because an event was received (no loop).
- A send that may have been taken is never tried again (a Zap run = tasks).
  The caps are reserved AND saved in /data before the request (no save, no
  request), and given back only when nothing surely left.
- The Catch Hook URLs and the inbound secret are secrets: never in a log, a
  status, /data or a message; a hook answered 404/410 is kept as an 8-bit
  salted fingerprint.
- The scene trigger is never fired by a scene action; the inbound handler
  never sends.
- Manifest keys (config, button, scene actions and trigger, webhook, fields,
  outputs) are forever.
- Docs, README, TODO.md, i18n follow the code.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except for a hand-pushed release tag, which bumps all three together
  before tagging (0.1.0 was set that way when leaving the template). `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
