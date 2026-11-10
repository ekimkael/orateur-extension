# Orateur — browser extension

Listen to articles and selected text directly on the page, or send them to
the [Orateur web app](https://orateur.digitalekim.net) for later.

The main extension targets Chrome (Manifest V3) and Firefox (Manifest V2),
using [WXT](https://wxt.dev). Edge uses the Chrome package.

## Features

- **Toolbar icon**: extracts the article from the active page (via
  [Readability](https://github.com/mozilla/readability)) and opens it in
  Orateur.
- **"Read with Orateur" / "Listen to selection later" context menu**: reads
  the selected text out loud on the page, or sends it to Orateur to read
  later — even outside of an article.
- **Floating bubble**: appears when hovering over a selection and reads it
  aloud. Saving a selection for later uses the context menu.
- **"Read this page" context menu**: reads the extracted article out loud
  directly on the page. On Firefox,
  Alt-clicking the toolbar icon does the same (Chrome doesn't expose modifier
  keys on the icon click).
- **"Read from here" context menu**: starts near the clicked paragraph when
  it can be matched to the extracted article. The reader also offers paragraph
  navigation, progress, pause/resume, speed, voice and follow-along highlighting.
- **Translated pages**: prepares current paragraph text from the live page
  as reading advances, so progressive browser translations can reach the
  speech engines. Preparation may wait for translation before audio resumes.
- **Settings**: English/French interface, light/dark/system theme, six reader
  positions, hidden sites, model downloads and personal pronunciation rules.

Choose an engine in the reading pill or settings. New installations default to
**Pocket TTS**. Updates preserve saved engines and voices, with the system
engine retained for older profiles without a saved engine.

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) runs locally in French
  and English. The first reading downloads about 140 MB for that language.
- [Supertonic](https://huggingface.co/Supertone/supertonic-3) runs locally on
  ONNX Runtime Web with ten voices. Its first reading or explicit download
  fetches about 400 MB.
- System voices use the browser's `speechSynthesis`. Availability depends on
  the browser and operating system, and some voices use an online service.

The two local engines work offline with their cached files. Unsupported
languages and private windows without cached models use a system voice for
the reading. Personal pronunciation rules apply with Supertonic and system voices.

In-page reading does not send article text to the Orateur web app. Explicit
save actions transfer extracted content, title, language and source URL; a
link or an inaccessible page can instead use the web app's URL import.
Internal browser pages and built-in PDF viewers do not allow the page reader.
In a PDF viewer, the context menu can send selected text to Orateur for later
when the browser exposes that selection; full-document PDF reading is unavailable.

Usage analytics are on by default when no preference is saved, but sending
requires valid build-time PostHog configuration. Users can turn them off in
Settings → Privacy; saved opt-outs remain respected after updates. Firefox
also requires its optional browser-level data collection permission. Events
exclude page text, titles and URLs. Reading progress stores URL, title and
paragraph position locally, separately from analytics. See [PRIVACY.md](PRIVACY.md)
and [the analytics guide](docs/analytics.md).

## Architecture

Two content scripts provide the reading pill and selection bubble. The
article extractor is injected on demand. The options page is a separate
extension page.

The reader pill is a view over a reading session (`lib/reading-session.ts`),
which drives one `Player` per reading. System speech runs in the page
(`lib/system-player.ts`). Supertonic and Pocket share the port adapter
(`lib/local-player.ts`) and audio ownership server (`lib/tts-port.ts`).
They synthesize in the Chrome offscreen document or Firefox background page,
with separate runtimes and model caches. Preferences and reading progress
live in `storage.local`. Supertonic uses OPFS and Pocket uses Cache Storage,
both on the extension origin.

See [docs/reading-architecture.md](docs/reading-architecture.md) for the
reading flow and its invariants, and
[docs/architecture.html](docs/architecture.html) for the interactive diagram
of the whole extension (open it directly in a browser, no server needed).

## Development

Use **Node.js 24 and npm 11**, matching the release environment. Install the
locked dependencies from this directory:

```bash
npm ci
npm run dev          # Chrome
npm run dev:firefox  # Firefox
npm run compile      # WXT preparation and TypeScript checks
npm test             # Node tests in lib/ and tests/
```

`npm ci` runs `wxt prepare` through `postinstall`. WXT launches the development
browser with the extension loaded. If Firefox is installed outside its default
location, set `FIREFOX_BIN` to its executable before running `dev:firefox`.

For development analytics, copy [.env.example](.env.example) to
`.env.local` and supply the public project key and region. Missing or invalid
configuration disables sending. Production ZIP builds can also load
`.env.production.local`; use explicit environment variables to select a test
project. Follow [the setup and validation guide](docs/analytics.md)
before publishing a configured package.

### Package and browser checks

Browser checks run against the built ZIPs:

```bash
npm run zip
npm run zip:firefox
npm run test:packages
npm exec puppeteer browsers install chrome
npm exec puppeteer browsers install firefox
npm run test:e2e
npm run test:e2e:firefox
```

See [the testing guide](docs/testing.md) for diagnostics, feature
coverage and required manual audio checks. Automated playback checks do not
replace listening to actual system, Supertonic and Pocket output.

### Reader design model

Open [docs/reader-model.html](docs/reader-model.html) for an interactive Anatomy
illustration of the current floating reader, drawn as a physical isometric
object. Its facade preserves the current proportions, typography, colors,
control positions and source icon paths; the casing and internal parts are a
physical interpretation, with five raised button caps. Playback is simulated. Try the drawn controls, both
themes and the exploded view. No audio plays and no model downloads.
Standalone vector exports are saved as `docs/reader-model.svg` and
`docs/reader-model-light.svg`.

Regenerate after changing the reader design:

```bash
node scripts/reader-model.mjs
node scripts/reader-model.mjs --light
node scripts/reader-model.mjs --audit
```

The generator uses the vendored MIT-licensed Anatomy kit in `scripts/anatomy/kit/`.

## Build

```bash
npm run build        # .output/chrome-mv3/
npm run build:firefox # .output/firefox-mv2/
npm run zip          # .output/orateur-extension-<version>-chrome.zip
npm run zip:firefox  # .output/orateur-extension-<version>-{firefox,sources}.zip
```

Chrome/Edge: enable developer mode in `chrome://extensions` or
`edge://extensions`, choose **Load unpacked**, and select `.output/chrome-mv3`.
Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, and select `.output/firefox-mv2/manifest.json`. Temporary Firefox
installation ends when the browser restarts.

The Chrome ZIP is also submitted to Edge Add-ons. `public/ort/` is generated
and ignored by Git: `copyOrtAssets()` copies three ONNX Runtime files from
`node_modules` when [wxt.config.ts](wxt.config.ts) loads, including during
`wxt prepare`. These runtime files are bundled; the Supertonic model weights
are downloaded only on request.

## Git Flow and releasing

`develop` is the integration branch. Create feature branches from `develop`
and integrate them through short pull requests targeting `develop`. Both
`develop` and `main` require pull requests and passing CI, including for
administrators. Human approval is not required for solo development.

"Feature finished" means the changes are committed, the pull request has
passed CI and been merged into `develop` with a merge commit, the feature
branch has been deleted locally and remotely, and local `develop` is up to
date. Finishing a feature does not publish a release.

Create `release/*` branches from `develop`; bump the version there, merge
into `main` through a pull request, tag the merge, then merge the release
back into `develop` through a pull request. Delete a release branch only
after both integrations. Create urgent `hotfix/*` branches from `main`
and merge them into both long-lived branches through pull requests before
deleting them.

CI runs on every pull request and on every merge into `develop`. It checks
types and Node tests, packages the extension, then tests those runtime
packages in Chrome and Firefox. The final `build` check requires both package
validation and browser jobs to pass.

Merging a `release/*` or `hotfix/*` pull request into `main` starts
[the release workflow](.github/workflows/release.yml), which replaces CI there.
It checks the version and its changelog section, builds and tests the
Chrome/Firefox packages and the Firefox source archive, then submits those exact
ZIPs (hash-checked) to every store with a configured extension/product ID; no
configured store makes the job fail. A repository admin then pushes the `v*`
tag on the merge commit, which publishes the GitHub Release with the ZIPs that
run submitted. Full steps: [docs/release.md](docs/release.md).

Release builds require the Actions variables `WXT_POSTHOG_KEY` and
`WXT_POSTHOG_REGION` (`eu` or `us`); local builds can omit them. Store
credentials (generated with `npx wxt submit init`) live in the `store` GitHub
environment, never in repository secrets: restrict its deployment branches and
tags to `main` and `v*`, and require a reviewer. The workflow also supports a
manual `dry_run` to check store authentication without submitting; a manual
real submission must run from `main`. See [analytics release setup](docs/analytics.md) and
[the testing guide](docs/testing.md) for verification requirements.

## Documentation

| Guide | Contents |
| --- | --- |
| [Selection reader](docs/selection-reader.md) | Bubble, context menus, text capture and supported surfaces |
| [Pronunciation](docs/pronunciation.md) | Text preparation, personal rules, preview and engine behavior |
| [Testing](docs/testing.md) | Node, package, browser and manual audio verification |
| [Analytics](docs/analytics.md) | PostHog configuration, event catalogue and release checks |
| [Privacy policy](PRIVACY.md) | Local storage, transfers and optional usage statistics |
| [Store listings: English](docs/store-listing.en.md) / [French](docs/store-listing.fr.md) | Main-extension copy, permissions and reviewer build instructions |
| [First-user programme](docs/premiers-utilisateurs.md) | Manual onboarding and feedback plan (French) |
| [Contributing](CONTRIBUTING.md) / [Agents](AGENTS.md) | Git Flow, commits, PRs, conventions and known traps |
| [Release](docs/release.md) / [Changelog](CHANGELOG.md) | Release steps, store submission and version history |

The [Gmail extraction audit](docs/gmail-newsletter-extraction.md),
[news extraction audit](docs/extraction-audit.md),
[tech audit](docs/extraction-tech-audit.md),
[international audit](docs/extraction-international-audit.md),
[health audit](docs/extraction-health-audit.md) and
[reader interface review](docs/reader-interface-review.md) record past checks.
Their measurements and test counts describe those checks, not a fresh run of
the current revision.
