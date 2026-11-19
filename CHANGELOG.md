# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The scene actions "Send to a Zap" (event and up to three values) and "Send JSON to a Zap"
  (a JSON object of 8 KB at most), to up to three Zapier Catch Hook URLs; outputs `request_id`
  and `tasks`.
- The scene trigger "Event received from Zapier", through the Gladys Plus webhook `inbound`
  (JSON, form or query string; optional shared secret; 60 events per minute at most).
- The button "Send a test event" (`gladys_test`), which also says whether events can come from
  Zapier.
- Caps of Zapier tasks over 24 hours (20 by default) and over 30 days (500 by default), 10 sends
  per minute at most, counted and saved in `/data` before each request.
- No second try of a send that may have been taken (timeout, cut connection, 5xx); one request
  at a time; a pause after a 429 (Retry-After, 60 s to 6 h) or a 5xx (60 s, doubled, 6 h at
  most); a hook answered 404/410 no longer used by scenes until a new URL or a test succeeds.
- A loop guard: 3 sends within 5 minutes each following an event received stop every send for
  30 minutes.
