# Orateur — browser extension

Listen to articles and selected text directly on the page, or send them to
the [Orateur web app](https://orateur.digitalekim.net) for later.

The main extension targets Chrome (Manifest V3) and Firefox (Manifest V2),
using [WXT](https://wxt.dev). Edge uses the Chrome package. Text-based PDFs
use the separate **Orateur PDF** companion; see [PDF setup and limitations](docs/pdf-reader.md).

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
- **Settings**: English/French interface, light/dark/system theme, six reader
  positions, hidden sites, model downloads and personal pronunciation rules.

Two engines back that in-page reading: the browser's built-in
`speechSynthesis` (the default, no Orateur model download) and
[Supertonic](https://huggingface.co/Supertone/supertonic-3), a neural voice
running locally on ONNX Runtime Web. Supertonic is opt-in from the reading
pill or settings. First playback, or an explicit download from settings,
downloads ~400 MB of models into the extension's OPFS. Synthesis then works
offline while that cache remains available.
It offers ten voices; unsupported languages fall back to the system engine.
System voices depend on the browser and OS; some may use a remote service.

In-page reading does not send article text to the Orateur web app. Explicit
save actions transfer extracted content, title, language and source URL; a
link or an inaccessible page can instead use the web app's URL import.
Internal browser pages and built-in PDF viewers do not allow the page reader.

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
extension page. System speech runs in the page reader; Supertonic requests
go through the background to a TTS host in an offscreen document (Chrome) or
the persistent background page (Firefox). That host owns chunk scheduling
and dual-`<audio>` playback, and delegates inference to ONNX Runtime Web.
Preferences and reading progress live in `storage.local`; the Supertonic
model cache lives in the extension's OPFS.

`optional/pdf/` provides the companion's own entrypoints, reader and settings.
Its PDF.js worker, fonts and character maps are bundled only by
`wxt.pdf.config.ts`. The companion works independently and has its own
preferences and model cache; installing the main extension is optional.

See [docs/architecture.html](docs/architecture.html) for the main extension's
interactive diagram (open it directly in a browser, no server needed).

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

See [the testing guide](docs/testing.md) for PDF checks, diagnostics, feature
coverage and required manual audio checks. Automated playback checks do not
replace listening to actual system and Supertonic output.

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

For the independent PDF companion:

```bash
npm run dev:pdf              # Chrome; dev:pdf:firefox also available
npm run zip:pdf              # .output/pdf/orateur-pdf-<version>-chrome.zip
npm run zip:pdf:firefox      # Firefox package and source archive in .output/pdf/
npm run test:packages -- --pdf
```

The final command expects both main-extension ZIPs and both PDF ZIPs. See
[the PDF guide](docs/pdf-reader.md) for loading the companion, file access,
supported documents and size limits.

## Git Flow and releasing

`develop` is the integration branch. Work on `develop` or a working branch;
do not commit or push directly to `main`. Create feature branches from
`develop` and merge them back through pull requests. Create `release/*`
branches from `develop`; bump the version there, merge into `main`, tag the merge, then merge
the release back into `develop`. Create urgent `hotfix/*` branches from `main`
and merge them into both long-lived branches.

CI checks types and Node tests, packages the main extension and PDF companion,
then tests those packages in Chrome and Firefox. The final `build` check
requires both package validation and browser jobs to pass.

Pushing a `v*` tag starts [the release workflow](.github/workflows/release.yml).
It checks that the tag's commit is reachable from `main` and that the tag
matches `package.json`, then builds and tests the main Chrome/Firefox packages
and generates the Firefox source archive. Submission and GitHub release upload
verify the runtime package hashes before using those same ZIPs; the source
archive is excluded from package validation and hash checks. Only stores with
a configured extension/product ID are selected; no configured store makes the job fail.
The PDF companion is checked in CI but is not submitted by this workflow.

Release builds require the Actions variables `WXT_POSTHOG_KEY` and
`WXT_POSTHOG_REGION` (`eu` or `us`); local builds can omit them. Store
credentials live in repository secrets; configure them with `npx wxt submit init`.
The workflow also supports a manual `dry_run` to check store authentication
without submitting. See [analytics release setup](docs/analytics.md) and
[the testing guide](docs/testing.md) for verification requirements.

## Documentation

| Guide | Contents |
| --- | --- |
| [Selection reader](docs/selection-reader.md) | Bubble, context menus, text capture and supported surfaces |
| [Pronunciation](docs/pronunciation.md) | Text preparation, personal rules, preview and engine behavior |
| [PDF companion](docs/pdf-reader.md) | Installation, local files, extraction and limits |
| [Testing](docs/testing.md) | Node, package, browser and manual audio verification |
| [Analytics](docs/analytics.md) | PostHog configuration, event catalogue and release checks |
| [Privacy policy](PRIVACY.md) | Local storage, transfers and optional usage statistics |
| [Store listings: English](docs/store-listing.en.md) / [French](docs/store-listing.fr.md) | Main-extension copy, permissions and reviewer build instructions |
| [First-user programme](docs/premiers-utilisateurs.md) | Manual onboarding and feedback plan (French) |

The [Gmail extraction audit](docs/gmail-newsletter-extraction.md),
[news extraction audit](docs/extraction-audit.md),
[tech audit](docs/extraction-tech-audit.md),
[international audit](docs/extraction-international-audit.md),
[health audit](docs/extraction-health-audit.md) and
[reader interface review](docs/reader-interface-review.md) record past checks.
Their measurements and test counts describe those checks, not a fresh run of
the current revision.
