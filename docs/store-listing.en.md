# Store listing — Orateur

Working file: content to copy-paste into the three consoles. Deliberately kept
out of the package (but included in the source archive).

Primary locale since `default_locale` switched to English (milestone 1a) —
see [store-listing.fr.md](store-listing.fr.md) for the French listing.

This listing covers the main extension. The [Orateur PDF companion](pdf-reader.md)
is installed and packaged separately; the main release workflow does not publish it.

- **Privacy policy**:
  <https://github.com/ekimkael/orateur-extension/blob/main/PRIVACY.md>
- **Site / support**: <https://github.com/ekimkael/orateur-extension>
- **Category**: Accessibility (Chrome / Edge), Other (AMO)
- **Primary language**: English

---

## Name

```
Orateur
```

## Short description (132 characters max)

```
Listen to any article or selected text, read aloud on the page or sent to Orateur.
```

## Long description

```
Orateur turns articles and selected text into audio.

━━ Listen right on the page ━━

Right-click → "Read this page." Orateur strips the article from the rest of
the page — menus, ads, sidebars — and reads it aloud. A discreet pill appears
at the bottom of the screen to pause, adjust speed, or change voice.
Right-click a paragraph and choose "Read from here" to start there when
Orateur can match it to the extracted article.

━━ Two voices, your choice ━━

• Your system's voice, ready instantly, nothing to download. This is the
  default. Some system voices use their provider's online service.
• Supertonic, a noticeably more natural neural voice that runs entirely on
  your machine. Its models download on first playback or when you request
  the download in settings (about 400 MB), then it works offline. Budget a
  few minutes for that first download.

━━ Send to Orateur ━━

Clicking the icon sends the page's article to the Orateur web app, to listen
to it, pick it up later, or keep it queued.

Select text anywhere and a bubble appears: "Listen" reads it aloud right on
the page. The context menu offers the same, plus "Listen to selection
later" to send it to Orateur.

Text-based PDFs use the separate Orateur PDF companion, installed independently.
The main extension does not read PDFs in the browser's built-in viewer.

━━ Privacy ━━

No account needed for in-page reading. Supertonic processes text locally after
its model download; system voice privacy depends on the selected voice provider.
Page text is sent to the Orateur web app only when you choose to save it there.
Usage statistics
are on by default and can be turned off in Settings → Privacy. They use a
random identifier and never include page text, titles or addresses. Saved
opt-outs remain respected after updates.

Details: https://github.com/ekimkael/orateur-extension/blob/main/PRIVACY.md
```

---

## Single purpose description (Chrome Web Store Privacy tab)

```
Orateur reads the current page's article, or any selected text, out loud —
either right on the page (system voice or an optional on-device neural
voice) or by sending it to the Orateur web app to listen there. That is the
extension's only function.
```

## Permission justifications (Chrome Web Store and Edge)

### `<all_urls>` — host + content scripts

```
The selection bubble and the reading pill need to already be present on the
page by the time the user acts: the bubble appears after selecting text,
and the pill must be able to show up as soon as the context menu is clicked.
A content script injected after the fact would arrive too late.

activeTab isn't enough. It only grants access after a click on the icon or a
context-menu entry — but clicking the reading pill isn't a "user gesture" in
the browser's sense, and article extraction triggered from that pill would be
denied injection.

Article extraction runs when the user requests reading or saving. Model
downloads and configured analytics requests run from extension pages or the
background, not the visited page. Analytics exclude page content. A selected
system voice may use its provider's online service.
```

### `scripting`

```
Inject the article extractor (Mozilla Readability) into the active tab on
demand, only when the user asks for a reading or a send to Orateur.
```

### `unlimitedStorage`

```
The local speech engine (Supertonic), if the user enables it, keeps about
400 MB of ONNX models in the extension's OPFS. Without this permission, the
per-origin quota can evict them and force a full re-download.
```

### `offscreen`

```
Speech synthesis needs a DOM and an <audio> element, which an MV3 service
worker doesn't have. The offscreen document hosts the engine, shared across
all tabs.
```

### `contextMenus`

```
Add "Save to Orateur," "Read with Orateur," "Listen to selection later,"
"Read this page," and "Read from here" to the context menu, according to
whether the user clicks a page, link or selection.
```

### `storage`

```
Remember reading preferences (engine, speed, voice), interface settings,
site exclusions, reading progress, personal pronunciation rules and the
analytics preference and identifier. Coordinate tabs so only one speaks
at a time.
```

### `activeTab`

```
Act on the current tab after a click on the extension icon or a context-menu
entry.
```

---

## Data usage declaration (Chrome Web Store)

- Declares **User activity** (usage events with a random identifier — analytics
  enabled, reading started and completed, errors, Supertonic download outcome,
  extraction failures; extension version) as collected, on by default and
  switchable off in settings. Verify the exact category label against the live CWS
  Developer Dashboard form at submission time — the taxonomy shifts
  occasionally.
- Everything else stays **none**.
- Check all three certifications: no sale to third parties, no use outside
  the stated purpose, no use to determine creditworthiness or lending — all
  still true with this telemetry.

## Firefox / AMO

- `data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] }`
  is already declared in the manifest (`wxt.config.ts`).
- **Build instructions** to paste into the dedicated field:

  ```
  Node 24, npm 11.

  npm ci
  npm run zip:firefox

  Without WXT_POSTHOG_KEY and WXT_POSTHOG_REGION, analytics are inactive.
  To reproduce a configured package, supply the same public PostHog project
  key and the eu or us region at build time, using environment variables or
  .env.production.local. See .env.example for the variable names.
  No personal API key is required.

  The submitted package is .output/orateur-extension-<version>-firefox.zip.

  Note: public/ort/ is not in the source archive — those three
  onnxruntime-web runtime files are copied from
  node_modules/onnxruntime-web/dist when wxt.config.ts loads, including during
  wxt prepare (the npm ci postinstall step), by copyOrtAssets().
  ```

- **Notes to the reviewer**:

  ```
  The extension bundles the onnxruntime-web WebAssembly runtime (26 MB,
  unmodified, from the onnxruntime-web npm package) to run the Supertonic
  speech engine locally.

  The ONNX models are not bundled: they're downloaded from the public
  repository https://huggingface.co/Supertone/supertonic-3 on first playback
  with that engine or an explicit settings download request (the default
  engine is the system's), and stored in the extension's OPFS. These are
  model weights, not executable code.

  lib/spike-checks.ts and lib/spike-phrase.ts are development test benches
  kept in the repo. They aren't imported by any entrypoint, so they don't
  appear in the built package.

  Telemetry can be turned off (lib/telemetry.ts): on by default when no
  preference is saved; existing opt-outs remain respected. Users can turn
  it off in Settings → Privacy.
  WXT_POSTHOG_KEY and WXT_POSTHOG_REGION are supplied at build time; missing or
  invalid configuration disables sending. Firefox also requires its optional
  technicalAndInteraction browser data collection permission; without a
  verifiable grant, no events are sent. When enabled, permitted and configured, a
  plain fetch() POST goes to PostHog
  (eu.i.posthog.com/i/v0/e/ or us.i.posthog.com/i/v0/e/, depending on the region) —
  no posthog-js, no third-party script, nothing beyond a JSON body with an
  event name, a locally-generated random id, and a closed set of technical
  properties including the extension version (see PRIVACY.md,
  "Optional usage analytics"). The background filters properties at
  runtime. Never page text, titles or URLs. Turning tracking off removes the
  local identifier and stops new events; it does not erase events already
  received.
  ```

---

## Screenshots

Chrome and Edge: at least one at 1280×800. Edge also wants a 300×300 logo.

1. The selection bubble over an article.
2. The reading pill in progress, settings open.
3. The context menu with Orateur's entries.
