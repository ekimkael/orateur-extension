# Optional PDF companion

Orateur PDF is a separate extension, built from this repository. Installing
Orateur alone adds no PDF.js code, worker, fonts or CMaps. Both extensions can
be installed together; their settings and model caches are independent.

## Build and install

```bash
npm ci
npm run build:pdf           # .output/pdf/chrome-mv3
npm run build:pdf:firefox   # .output/pdf/firefox-mv2
npm run zip:pdf             # .output/pdf/orateur-pdf-<version>-chrome.zip
npm run zip:pdf:firefox      # Firefox ZIP and source archive in .output/pdf
```

Chrome: enable developer mode in `chrome://extensions`, choose **Load
unpacked**, then select `.output/pdf/chrome-mv3`.
Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, then select `.output/pdf/firefox-mv2/manifest.json`. This development
installation lasts until Firefox restarts. Store distribution requires a
separate listing/signature; the existing release workflow publishes only the
main extension. CI builds the main extension and companion for both browsers
as downloadable artifacts.

Development commands: `npm run dev:pdf` and `npm run dev:pdf:firefox`.

## Read a PDF

Open a PDF tab and click the **Orateur PDF** toolbar icon, or use its context
menu on a PDF link. The companion downloads the source and extracts its text
locally, independently of the browser's PDF viewer. URLs without `.pdf` work
when they return a PDF. HTTP authentication depends on cookies the browser
allows with the request; failed downloads can be retried or opened as files.

For a local PDF, use **Choose a PDF file**. Direct `file://` URLs on Chrome
require **Allow access to file URLs** in the companion's extension settings.
The file picker also works without that permission.

Extraction shows progress and can be cancelled. Choose a local system voice
or Supertonic, then read, pause, resume, stop, adjust speed or follow the current
paragraph. System voices marked as remote are excluded. Supertonic downloads
about 400 MB of models on first use; this cache is separate from Orateur's.

Open **Pronunciation** in the PDF reader to add personal pronunciation rules
and preview them with the selected engine. Rules remain local to the companion;
they are not shared with the main extension. The same section provides an
explicit Supertonic model download, with progress, cancellation and retry.
Starting playback in another companion tab stops the previous tab's reading.

## Privacy and limits

PDF bytes and extracted text are processed on the device. The source host
receives the PDF download request; the model host receives model downloads
when Supertonic is selected. No PDF or extracted text is uploaded. PDF scripts,
forms and linked resources are not rendered or executed. The companion does
not send usage analytics.

PDF.js 6.4.299, its worker, fonts and CMaps are packaged by
[`wxt.pdf.config.ts`](../wxt.pdf.config.ts). The companion also includes the
speech runtime. Package sizes depend on the build; inspect `.output/pdf`
after building rather than treating the PDF.js dependency size as the total
installation size.

Supported layout: text-based PDFs, page order, simple single columns and
paragraphs. Repeated headers/footers are removed only when their text and
position unambiguously recur on at least three pages. Complex columns, tables
and unusual reading directions may need manual review. No OCR is included.

Limits: 50 MiB per file, 2,000 pages, 5 million extracted characters and
500,000 text items. Password protection, copying restrictions, image-only
documents, invalid documents, oversized files and download errors produce
explicit messages. Password entry is not supported.

Synthetic fixtures and regression tests cover extraction order, repeated
margins, encrypted/restricted documents, image-only documents, cancellation,
download bounds and local-only speech selection. Run `npm test`.

See [testing](testing.md) for package validation and browser scenarios using
the packaged PDF.js worker. Main-extension checks do not include the companion
unless `--pdf` and `ORATEUR_TEST_PDF=1` are supplied to their respective commands.

## Implementation

- [`optional/pdf/entrypoints/background.ts`](../optional/pdf/entrypoints/background.ts)
  opens the companion reader from toolbar and context-menu actions.
- [`lib/pdf-source.ts`](../lib/pdf-source.ts) validates URLs and bounds downloads.
- [`lib/pdf-extract.ts`](../lib/pdf-extract.ts) runs PDF.js extraction;
  [`lib/pdf-text.ts`](../lib/pdf-text.ts) reconstructs lines and paragraphs.
- [`optional/pdf/entrypoints/pdf/App.tsx`](../optional/pdf/entrypoints/pdf/App.tsx)
  owns extraction state and playback. Local system voices use
  [`lib/pdf-player.ts`](../lib/pdf-player.ts); Supertonic uses the shared
  [`lib/tts-host.ts`](../lib/tts-host.ts) inside the reader tab.
