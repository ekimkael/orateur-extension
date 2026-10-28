# Reading architecture

How the reader pill turns a page into speech, and which module owns what.
For the whole extension at a glance, open [architecture.html](architecture.html);
it is generated with archify from [architecture.json](architecture.json).

## Layers

| Layer | Module | Owns |
|---|---|---|
| Wiring | `entrypoints/reader.content.ts` | The pill's DOM and CSS, the follower highlight, and the listeners that forward user actions, extension messages and page lifecycle to the session. |
| Session | `lib/reading-session.ts` | One tab's reading: engine choice, the paragraph shown by the pill, saved progress, telemetry, the tab's reader token. Builds no DOM. |
| Player contract | `lib/player.ts` | `start / pause / resume / seek / update / stop / dispose`, and the events an engine reports (`loading`, `playing`, `paused`, `ended`, `error`). |
| System engine | `lib/system-player.ts` | `speechSynthesis`, one utterance per paragraph, and the paragraph and word position. |
| Supertonic engine | `lib/supertonic-player.ts` | The tab's end of the TTS port: commands out, host events in, live paragraph answers. |
| TTS host server | `lib/tts-port.ts` | The host's end of the ports: which tab owns the host, its commands, its events and its paragraph requests. |
| TTS host | `lib/tts-host.ts` | Chunking, synthesis cache, scheduling and dual-`<audio>` playback (Chrome offscreen document, Firefox background page). |

The session is tested with `node --test` against fake views, a fake page and a
fake `speechSynthesis`; the players and the port server are tested the same
way. Only the wiring needs a browser (`npm run test:e2e`).

## Supertonic: the port

1. The Supertonic player sends `TTS_OPEN` to the background, which creates the
   offscreen document on Chrome (Firefox already hosts it in its background page).
2. The player opens `runtime.connect({ name: TTS_PORT })` and sends `TTS_SPEAK`.
   Commands given before the port opens wait for it, in order.
3. The host answers on the same port: `TTS_EVENT` states, and `TTS_PREPARE_BLOCK`
   requests for live pages, which the tab answers with `TTS_PREPARED` and the same `id`.

The background no longer relays commands, events or paragraph requests.

## Invariants

- **One owner.** The last port to send `TTS_SPEAK` owns the host. Commands from
  any other port are ignored, and the previous owner's unanswered paragraph
  requests fail.
- **Closing the port stops the reading.** The player's `dispose()` closes it, so
  a folded pill releases the host. If the host closes it first (Chrome closes an
  idle offscreen document), the pill folds into its error state, from which
  the user can start again, instead of staying on a silent "playing" state.
- **Ports are not the only safety net.** Firefox keeps a page's port open while
  the page sits in the back-forward cache, so the host still stops when:
  - another tab takes the floor (`READER_TOKEN` changes; the background relays
    it as `TTS_TOKEN_CHANGED`, since the offscreen document has no `storage`);
  - the owning tab closes (`tabs.onRemoved`, relayed as `TTS_TAB_REMOVED`);
  - the page is hidden (`pagehide` stops the player from the tab).
- **One voice for the whole browser.** `speechSynthesis` is shared by all tabs:
  starting a reading writes the tab's token to `READER_TOKEN`, and every other
  pill folds when it sees another token.
- **Stale callbacks are ignored.** Each player is created per reading and
  `dispose()`d when the session moves on. The session ignores events from any
  player but the current one.
