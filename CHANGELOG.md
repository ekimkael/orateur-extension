# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Discard existing reading progress when migrating to URL hashes without saved page titles. Private windows no longer read or save progress.

## [0.11.0] - 2026-11-10

### Added

- At the end of an article, the reader thanks you in the article's own voice ("End of the article, thank you for listening."). On the first article, then every third one, it also invites you to support Orateur, and the pill shows "Thanks for listening · ♥ Support" with a link to the donation page and a button to stop the voice. The thanks is spoken in French and English; pages in other languages get the link without the spoken message. Selections and X posts end as before.
- Settings have a new Support section, and a Support link in the footer.

## [0.10.0] - 2026-11-09

### Added

- Pocket TTS, a third voice engine that runs on your device, reads French and English. The first reading in each language downloads about 140 MB, checked file by file, then it works offline. Each engine keeps its own voice. Supertonic stays the default for new installations, and updates keep your engine and voices. Personal pronunciation rules stay saved but apply only to Supertonic and system voices.
- The reader's ✕ now shows "Orateur hidden on this site · Undo" for five seconds, so a stray click can be taken back without opening Settings.
- Small data tables (up to 8 rows and 4 columns) are read row by row, each value after its column header. Larger or irregular tables get a short notice instead of being read cell by cell.
- Code blocks are announced with a sentence that points to the code below.

### Changed

- Settings list the Supertonic voices female first, like the reader.
- Usage statistics also count Pocket TTS model downloads and uses of the reader's ✕ and Undo, never the site. See [PRIVACY.md](PRIVACY.md).

### Fixed

- A reading that cannot start, for example after a saved voice became unavailable, no longer leaves the reader stuck on loading: it shows an error you can retry from.
- Sentences written entirely in capitals are read as normal sentences, keeping short acronyms, so Supertonic no longer mishears them.
- Supertonic pauses on a slash between two words instead of running them together.

## [0.9.0] - 2026-11-05

### Added

- X (Twitter): "Read this page" on a post reads only that post, paragraph by paragraph. It skips the author, counters, quoted posts, replies, links, emoji and closing hashtags, and the page highlight follows each paragraph. X Articles are read to their last line, without the URLs of their resource lists. Off a post, the extension says there is nothing to read instead of reading the app.

### Changed

- Posts have no spoken intro: the first line is read once, not twice. The post still keeps its author and first line as its title in the reader and in Orateur.
- Usage statistics now include the browser name and its major version, never the raw User-Agent. See [PRIVACY.md](PRIVACY.md).

### Fixed

- French all-caps headlines are read as words: accented words such as "BÉNIN" are no longer split, and short words such as "LE", "DE" or "PAS" are no longer spelled letter by letter.
- Supertonic says "dix-sept" without a doubled "s".
- Text selected in a password field is never captured for reading.

## [0.8.8] - 2026-10-28

### Fixed

- Numbers, times and dates are read out correctly.

### Changed

- Pages load and the speech engine starts faster: the voice list is built when settings first open instead of on every page, preferences load in parallel, and ONNX Runtime placement warnings no longer show up as extension errors.
- Contributors: both speech engines now sit behind one `Player` interface, the reading session moved out of the content script, and the tab talks to the TTS host over a direct port. See [docs/reading-architecture.md](docs/reading-architecture.md).

## [0.8.7] - 2026-10-28

### Fixed

- Gmail newsletters skip labelled sponsor cards.
- Paragraphs keep their detected language when a live page is prepared again.
- English is detected in long, content-heavy text.

## [0.8.6] - 2026-10-28

### Security

- No change for users. Store credentials are scoped to a protected `store` environment, and the CI token is read-only.

## [0.8.5] - 2026-10-27

### Added

- A "Download the voices" button in the reader settings fetches the natural voices from the pill.

### Changed

- New installs use the natural AI voices by default. Updates keep the system voice for anyone who never saved a setting, so nobody gets a 398 MB download unasked.
- In a private window without the downloaded voices, Orateur reads with the system voice and says why.

### Fixed

- Switching engine during a reading now stops the running engine instead of resuming the old one.
- English Gmail digests are detected and read.

## [0.8.4] - 2026-10-27

### Changed

- Anonymous usage statistics are on by default when no preference is saved. Existing opt-outs are kept, Settings → Privacy turns them off, and Firefox also asks for its optional data-collection permission. Events never include page text, titles or URLs.
- Listening is counted only once audio actually starts, with bounded completion and failure events.
- Contributors: release packages are validated and tested in Chrome and Firefox before store submission.

### Fixed

- Better article extraction and paragraph matching on news, technical, international and health sites.
- Reading translated pages and preparing the next paragraphs stay reliable through late playback confirmations, pause and resume, and failed preparation.

## [0.8.3] - 2026-10-27

### Fixed

- On translated pages, paragraphs are refreshed before speech, so Orateur reads the translated text.
- Natural voices keep preparing upcoming paragraphs across short headings, without a silent wait.

## [0.8.2] - 2026-10-27

### Fixed

- On translated pages, a saved system voice is used only when it matches the paragraph's language; otherwise the browser picks a voice for the detected language.

## [0.8.1] - 2026-10-17

### Fixed

- Chrome loads the extension again (0.8.0 was refused because of invalid message names).
- Reading works in tabs opened before Orateur was installed or updated.

## [0.8.0] - 2026-10-16

### Added

- Personal pronunciation rules, with local French and English dictionaries and a spoken preview.
- Grouped numbers are normalized before speech.

### Changed

- Settings show one section at a time, with keyboard navigation and unsaved drafts preserved.

## [0.7.0] - 2026-10-16

### Added

- In Gmail, Orateur reads only the open message.
- The reader pill animates its layout changes.

### Fixed

- A trailing comma becomes the added final period instead of being doubled.
- For the natural voices, the text's detected language now overrides the language the page declares.

## [0.6.0] - 2026-10-09

### Changed

- Engine loading and voice downloads stay in the compact pill, with a spinner or an inline progress bar.
- The player matches its settings panel's width. Opening settings folds the player into a pill; closing them restores the title and playback status.
- The settings button uses a gear icon and closes settings on a second click.

### Fixed

- The first-download explanation appears only when the voices are confirmed missing.
- Better keyboard focus and screen-reader status announcements; late playback events after stopping are ignored.

## [0.5.0] - 2026-09-27

### Added

- Move to the previous or next paragraph while reading.
- Resume an interrupted reading where it stopped.

### Fixed

- More reliable reading and settings feedback.
- Accessibility, color contrast and wording fixes in settings.

## [0.4.0] - 2026-08-27

### Added

- The tab title shows a speaker icon while Orateur reads.
- Download the natural-voice model ahead of time from settings.
- The pill settings show whether the model is already downloaded.
- Short titles and list items get their own language detection.

### Fixed

- The pending-model message stays accurate without the download button.

## [0.3.0] - 2026-08-25

### Added

- Each paragraph's language is detected, so it is read with a matching voice.
- Choose where the reader pill sits on the page.

### Changed

- The selection bubble reads the selection on the page instead of opening Orateur. "Listen later" moved to the context menu.

### Fixed

- Reading speed is formatted for the browser's language.

## [0.2.0] - 2026-08-24

### Added

- English and French interface, and a new settings page.
- Turn Orateur off on chosen sites.
- The paragraph being read is highlighted and followed on the page.
- Settings play real samples of the natural voices.
- Opt-in anonymous usage statistics.

### Changed

- The pill and the selection bubble follow Orateur's visual identity, with the real logo as icon.

### Fixed

- The reader prepares one paragraph at a time instead of queuing the whole page at once.

## [0.1.1] - 2026-08-21

First public release on the Chrome Web Store and Firefox Add-ons.

### Added

- Listen to the current article in place, from the context menu or with Alt-click, in a floating pill with play, pause and stop.
- Listen to a text selection from a bubble next to it.
- Save the current article or a selection to Orateur to listen later.
- Pill settings for engine (system voice or natural Supertonic voices), speed and voice.
- Readings announce the title, skip text that should not be heard, and add natural pauses.
- Natural voices run on the device, with WebGPU when available and WebAssembly otherwise. A loading indicator shows while they start, and the speech host closes itself after inactivity.

### Fixed

- Japanese and Korean sentences are split correctly for the natural voices.
- Pause, stop and errors respond while the natural voices load, and resume no longer replays a finished paragraph.

[Unreleased]: https://github.com/ekimkael/orateur-extension/compare/v0.8.8...HEAD
[0.8.8]: https://github.com/ekimkael/orateur-extension/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/ekimkael/orateur-extension/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/ekimkael/orateur-extension/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/ekimkael/orateur-extension/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/ekimkael/orateur-extension/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/ekimkael/orateur-extension/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/ekimkael/orateur-extension/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/ekimkael/orateur-extension/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/ekimkael/orateur-extension/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ekimkael/orateur-extension/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ekimkael/orateur-extension/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ekimkael/orateur-extension/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ekimkael/orateur-extension/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ekimkael/orateur-extension/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ekimkael/orateur-extension/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ekimkael/orateur-extension/releases/tag/v0.1.1
