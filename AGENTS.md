# AGENTS.md — Orateur browser extension

Guide for AI coding agents (Claude, Codex, Copilot…). `CLAUDE.md` imports this file; keep shared rules here, not there.
Workflow rules (Git Flow, commits, PRs, changelog, release) live in [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/release.md](docs/release.md).

## Project

Chrome and Firefox extension (Manifest V3) that reads web pages and text selections aloud, with the browser's system voices or the on-device Supertonic voices (ONNX Runtime Web), and hands articles and selections to the Orateur web app to listen later. Published on the Chrome Web Store and Firefox Add-ons; [README.md](README.md) is the product overview.

## Rules

- Work on `develop` or a branch off it. `main` holds releases only: never commit or push to it directly.
- Everything committed is in English: code, comments, commit messages, PRs, changelog, releases, docs. User-facing copy is translated in `public/_locales/{en,fr}`.
- PDF development, packaging and publication are excluded unless the user explicitly asks for PDF. Do not propose PDF work or ask whether to include it.

## Stack

Read the docs at these exact versions before changing code that uses them.

| Tool | Version | Docs |
|---|---|---|
| Node.js / npm | 24 / 11 | https://nodejs.org/docs/latest-v24.x/api/ |
| WXT | 0.21.4 | https://wxt.dev |
| React | 19.2 | https://react.dev |
| TypeScript | 5.9 | https://www.typescriptlang.org/docs/ |
| @mozilla/readability | 0.6.0 | https://github.com/mozilla/readability/tree/0.6.0 |
| onnxruntime-web | 1.26 | https://onnxruntime.ai/docs/ |
| Puppeteer (browser tests) | 25.14.0 | https://pptr.dev |
| web-ext | 10.6 | https://extensionworkshop.com/documentation/develop/web-ext-command-reference/ |
| jsdom (Node tests) | 29.1 | https://github.com/jsdom/jsdom |

## Commands

```bash
npm ci                  # also runs `wxt prepare`
npm run dev             # Chrome with the extension loaded
npm run dev:firefox     # Firefox (set FIREFOX_BIN if it is not in the default location)
npm run compile         # wxt prepare + tsc --noEmit (there is no lint script)
npm test                # Node tests: lib/**/*.test.ts and tests/*.test.mjs
npm run zip && npm run zip:firefox && npm run test:packages   # build and validate the store ZIPs
npm run test:e2e && npm run test:e2e:firefox                  # browser suites on those ZIPs
npm run validate:changelog
```

Browser suites need `npm exec puppeteer browsers install chrome` (and `firefox`) once. Details: [docs/testing.md](docs/testing.md).

## Structure

- `entrypoints/`: WXT entry points. `reader.content.ts` (reader pill wiring), `selection.content.ts` (selection bubble), `extract.content.ts` (article extractor, injected on demand), `background.ts`, `offscreen/` (Chrome TTS host), `options/` (React settings page).
- `lib/`: logic, tested with `node --test`. `reading-session.ts` owns one tab's reading; `player.ts` is the engine contract; `system-player.ts` and `supertonic-player.ts` implement it; `tts-port.ts` and `tts-host.ts` are the TTS host; `extract-article.ts` wraps Readability.
- `lib/supertonic/`: ONNX engine and OPFS model cache. `lib/pronunciation/`: number and personal-rule text preparation.
- `components/`, `hooks/`: React UI for the options page.
- `public/_locales/`: EN/FR messages. `public/ort/` is copied at build time and ignored by git.
- `tests/`: package test, browser e2e harness and fixtures. `scripts/`: package check, browser test runner, reader design model.
- `docs/`: reference docs, linked below.

Layers, the TTS port and the reading invariants: [docs/reading-architecture.md](docs/reading-architecture.md). Whole extension: [docs/architecture.html](docs/architecture.html) (generated from `docs/architecture.json`).

## Docs to read before changing an area

| Area | Doc |
|---|---|
| Reading, players, TTS host | [docs/reading-architecture.md](docs/reading-architecture.md) |
| Selection bubble and context menus | [docs/selection-reader.md](docs/selection-reader.md) |
| Text preparation and pronunciation rules | [docs/pronunciation.md](docs/pronunciation.md) |
| Article extraction | [docs/extraction-audit.md](docs/extraction-audit.md) and the `docs/extraction-*-audit.md` files, [docs/gmail-newsletter-extraction.md](docs/gmail-newsletter-extraction.md) |
| Telemetry (PostHog) | [docs/analytics.md](docs/analytics.md), [PRIVACY.md](PRIVACY.md) |
| Tests and manual QA | [docs/testing.md](docs/testing.md) |
| Store copy and permissions | [docs/store-listing.en.md](docs/store-listing.en.md), [docs/store-listing.fr.md](docs/store-listing.fr.md) |
| Reader UI review | [docs/reader-interface-review.md](docs/reader-interface-review.md) |

## Conventions

- Business logic goes in `lib/` with a `node --test` test next to it; entry points stay thin wiring.
- Engines are driven only through the `Player` interface. The session ignores events from any player but the current one.
- A bug fix comes with a regression test that fails before the fix. Changed or removed assertions are justified against product guarantees in the PR ([docs/testing.md](docs/testing.md)).
- Telemetry events never carry page text, titles, URLs or free-form errors.

## Known traps

- **A green build does not prove the browser accepts the extension.** 0.8.0 built fine and Chrome refused to load it. Run `test:packages` and the browser suites on the ZIPs.
- **i18n message names must not contain hyphens**, or Chrome refuses the whole extension (the 0.8.0 → 0.8.1 hotfix).
- **Tabs opened before install or update have no content script.** The reader is injected on demand before retrying; keep that path when touching startup.
- **Simulated speech proves nothing audible.** Browser tests fake `speechSynthesis` and synthesis. Audio, voice or preloading changes need real listening in Chrome and Firefox ([docs/testing.md](docs/testing.md)).
- **Supertonic lookahead across short headings and translated pages** regressed repeatedly (0.8.3, 0.8.7). Test both with and without text preparation.
- **Firefox driver limits:** WebDriver BiDi cannot click the toolbar action (that scenario is skipped), and some extension-page load events are filtered, so the harness navigates with `wait: "none"` and waits for DOM state.
- **The reader and bubble use a closed Shadow DOM.** Tests read it through `openOrClosedShadowRoot`; do not change the shadow mode to make tests easier.
- **Attaching a debugger changes MV3 service-worker sleep**, so lifecycle bugs can vanish under DevTools.
- **Built-in PDF viewers reject the injected reader.** Do not "fix" it: PDF is out of scope unless asked.
- **Lockfile:** regenerate `package-lock.json` with npm 11. Another npm can drop Linux optional-dependency entries and break `npm ci` in CI (fixed in 0.8.4).
- **Release builds need the `WXT_POSTHOG_KEY` and `WXT_POSTHOG_REGION` Actions variables**; local builds work without them. Never commit `.env.local` or `.env.submit`.
- **Stores refuse a version they already have.** A merge into `main` submits to the stores; re-running that release run resubmits everywhere. An admin then tags the merge commit by hand ([docs/release.md](docs/release.md)).

## Definition of done

- `npm run compile` and `npm test` pass; `test:packages` and the browser suites pass for build, manifest or lifecycle changes.
- Exports have JSDoc; non-obvious code explains its invariants and why.
- Docs touched by the change are updated.
- Anything user-visible was checked in the running extension, in Chrome and Firefox.
