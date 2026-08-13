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
- **"Read this page" context menu**: reads the extracted article out loud
  directly on the page, using the browser's built-in text-to-speech — no
  tab opened, nothing sent to Orateur. On Firefox, Alt-clicking the toolbar
  icon does the same (Chrome doesn't expose modifier keys on the icon
  click).

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
