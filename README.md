# Orateur — browser extension

Send the current page's article, or any selected text, to Orateur to
listen to it.

## Features

- **Toolbar icon**: extracts the article from the active page (via
  [Readability](https://github.com/mozilla/readability)) and opens it in
  Orateur.
- **"Read with Orateur" context menu**: sends the selected text, even
  outside of an article.
- **Floating bubble**: appears when hovering over a selection, to start
  reading without going through the menu.

Works on Chrome (MV3) and Firefox (MV2), via [WXT](https://wxt.dev).

## Development

```bash
npm install
npm run dev          # Chrome
npm run dev:firefox  # Firefox
npm test             # unit tests (lib/*.test.ts)
```

See [docs/selection-reader.md](docs/selection-reader.md) for how selection
and the floating bubble work in detail.
