# Orateur — browser extension

Send the current page's article, or any selected text, to Orateur to
listen to it.

## Features

- **Toolbar icon**: extracts the article from the active page (via
  [Readability](https://github.com/mozilla/readability)) and opens it in
  Orateur.
- **"Read with Orateur" / "Listen to selection later" context menu**: reads
  the selected text out loud on the page, or sends it to Orateur to read
  later — even outside of an article.
- **Floating bubble**: appears when hovering over a selection, with the same
  two actions, without going through the menu.
- **"Read this page" context menu**: reads the extracted article out loud
  directly on the page — no tab opened, nothing sent to Orateur. On Firefox,
  Alt-clicking the toolbar icon does the same (Chrome doesn't expose modifier
  keys on the icon click).

Two engines back that in-page reading: the browser's built-in
`speechSynthesis` (the default, nothing to download) and
[Supertonic](https://huggingface.co/Supertone/supertonic-3), a neural voice
running locally on ONNX Runtime Web. Supertonic is opt-in from the reading
pill: switching to it downloads ~400 MB of models once into the extension's
OPFS, after which it works offline.

Works on Chrome (MV3) and Firefox (MV2), via [WXT](https://wxt.dev).

## Development

```bash
npm install
npm run dev          # Chrome
npm run dev:firefox  # Firefox
npm test             # unit tests (lib/*.test.ts)
```

## Build

```bash
npm install
npm run zip          # .output/orateur-extension-<version>-chrome.zip
npm run zip:firefox  # ...-firefox.zip and ...-sources.zip
```

The Chrome zip is also what gets submitted to Edge Add-ons. `public/ort/` is
not committed: the three onnxruntime-web runtime files are copied out of
`node_modules` at `buildStart` by the `copyOrtAssets()` Vite plugin in
[wxt.config.ts](wxt.config.ts).

## Releasing

Merge into `main`, then tag — `.github/workflows/release.yml` builds the three
zips, submits them to the Chrome Web Store, AMO and Edge Add-ons, and attaches
them to a GitHub release:

```bash
npm version patch && git push --follow-tags
```

The workflow refuses a tag that isn't on `main` or that doesn't match
`package.json`. Store credentials live in the repository secrets; regenerate
them locally with `npx wxt submit init`.

See [PRIVACY.md](PRIVACY.md) and
[docs/store-listing.en.md](docs/store-listing.en.md) (also available in
[French](docs/store-listing.fr.md)) for the store-facing material.

See [docs/selection-reader.md](docs/selection-reader.md) for how selection
and the floating bubble work in detail.
