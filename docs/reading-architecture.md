# Reading architecture

How the reader pill turns a page into speech, and which module owns what.
For the whole extension at a glance, open [architecture.html](architecture.html);
it is generated with archify from [architecture.json](architecture.json).

## Layers

| Layer | Module | Owns |
|---|---|---|
| Wiring | `entrypoints/reader.content/` | `pill.ts`: the pill's DOM (CSS in `styles.ts`). `follower.ts`: the paragraph highlight. `index.ts`: the listeners that forward user actions, extension messages and page lifecycle to the session. |
| Session | `lib/reading-session.ts` | One tab's reading: the paragraph shown by the pill, saved progress, telemetry, the tab's reader token. Builds no DOM. |
| Player factory | `lib/player-factory.ts` | Resolves the effective engine from the saved choice, text language and cache availability, then creates its player. |
| Player contract | `lib/player.ts` | `start / pause / resume / seek / update / stop / dispose`, and the events an engine reports (`loading`, `playing`, `paused`, `ended`, `error`). |
| System engine | `lib/system-player.ts` | `speechSynthesis`, one utterance per paragraph, and the paragraph and word position. |
| Local players | `lib/local-player.ts` | The tab's end of the TTS port: engine-specific commands out, host events in, live paragraph answers. |
| TTS host server | `lib/tts-port.ts` | The host's end of the ports: which tab owns the host, its commands, its events and its paragraph requests. |
| Supertonic host | `lib/tts-host.ts` | Pronunciation, synthesis cache, scheduling and dual-`<audio>` playback. |
| Pocket host | `lib/pocket-tts-host.ts` | Bounded units that start at 80 characters after each start or seek and grow at most 1.75x per unit up to 180 (faster first sound, no gap at RTF ~0.6), 0.6 s of silence after a sentence and 1 s after a paragraph, none after the last unit (Pocket barely trails a unit), three units of lookahead (live paragraphs are prefetched passively, then promoted when playback reaches them) and worker synthesis. The Pocket cache is separate and the host receives no pronunciation rules. |

The session is tested with `node --test` against fake views, a fake page and a
fake `speechSynthesis`; the players and the port server are tested the same
way. Only the wiring needs a browser (`npm run test:e2e`).

## What is spoken instead of code and tables

Extraction (`toSpeakableText` in `lib/extract-article.ts`) never reads source code or a large table cell by cell:

- A `<pre>` block becomes one notice ("You can get an overview by looking at the code below."). Consecutive blocks share one notice.
- A data table (it has a `thead`, or a first row made only of `th`) with at most 8 data rows and 4 columns is read row by row by `lib/speak-table.ts`. Each value comes after its column header: "Pomme : prix, 2 € ; stock, 12." A caption is read first.
- A data table that is larger, has merged cells, a nested table or rows of uneven length becomes one notice ("You can look at the table below.").
- A table without a header row is a layout table (Gmail newsletters, older sites). Its cells are still read as paragraphs.

"Below" is accurate because these sentences are not in the page. The follower cannot find them, so the paragraph just above stays highlighted. Notices exist in fr (the default), en, es, de, it and pt.

## Local engines and the port

1. The local player sends `TTS_OPEN` to the background, which creates the
   offscreen document on Chrome (Firefox already hosts it in its background page).
2. The player opens `runtime.connect({ name: TTS_PORT })` and sends `TTS_SPEAK`
   with its engine, language and voice. The server validates those fields and
   answers a refused request with an error event on that port only, so the pill
   folds instead of waiting and the current owner keeps reading.
   Commands given before the port opens wait for it, in order.
3. The host answers on the same port: `TTS_EVENT` states, and `TTS_PREPARE_BLOCK`
   requests for live pages, which the tab answers with `TTS_PREPARED` and the same `id`.

The background no longer relays commands, events or paragraph requests.

The first installation saves Supertonic. Updates keep stored engines and voices.
The system engine is the compatibility choice for profiles from before the
engine preference. Language and private-window fallbacks affect only the
effective engine for one reading. That engine determines whether to load and
apply pronunciation rules.

## Invariants

- **One owner.** The last port to send `TTS_SPEAK` owns the host. Commands from
  any other port are ignored, and the previous owner's unanswered paragraph
  requests fail. Switching between Pocket and Supertonic stops and retires
  the previous host before it can emit events for the new owner.
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
