# Store listing — Orateur v0.1.1

Working file: content to copy-paste into the three consoles. Deliberately kept
out of the package (but included in the source archive).

Primary locale since `default_locale` switched to English (milestone 1a) —
see [store-listing.fr.md](store-listing.fr.md) for the French listing.

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
Orateur turns any page into an audio reading.

━━ Listen right on the page ━━

Right-click → "Read this page." Orateur strips the article from the rest of
the page — menus, ads, sidebars — and reads it aloud. A discreet pill appears
at the bottom of the screen to pause, adjust speed, or change voice. Nothing
leaves your browser.

━━ Two voices, your choice ━━

• Your system's voice, ready instantly, nothing to download. This is the
  default.
• Supertonic, a noticeably more natural neural voice that runs entirely on
  your machine. Turning it on downloads its models once (about 400 MB), then
  it works offline. Budget a few minutes for that first download.

━━ Send to Orateur ━━

Clicking the icon sends the page's article to the Orateur web app, to listen
to it, pick it up later, or keep it queued.

Select text anywhere and a bubble appears: "Listen" reads it aloud right on
the page, "Listen later" sends it to Orateur. The same is available from the
context menu under "Read with Orateur" and "Listen to selection later."

━━ Privacy ━━

No account. Nothing is collected by default. The text you listen to on the
page never leaves your machine. Nothing is sent to Orateur unless you click to
ask for it. Anonymous usage statistics are entirely optional, off by default,
and can be turned on (or back off) from the extension's settings.

Details: https://github.com/ekimkael/orateur-extension/blob/main/PRIVACY.md
```

---

## Permission justifications (Chrome Web Store and Edge)

### `<all_urls>` — host + content scripts

```
The selection bubble and the reading pill need to already be present on the
page by the time the user acts: the bubble appears on hovering a selection,
and the pill must be able to show up as soon as the context menu is clicked.
A content script injected after the fact would arrive too late.

activeTab isn't enough. It only grants access after a click on the icon or a
context-menu entry — but clicking the reading pill isn't a "user gesture" in
the browser's sense, and article extraction triggered from that pill would be
denied injection.

The extension doesn't read the content of any page until the user asks for
it, and never makes a network request from visited pages.
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
Add the "Read with Orateur," "Listen to selection later," and "Read this
page" entries to the context menu.
```

### `storage`

```
Remember reading preferences (engine, speed, voice) and coordinate tabs, so
only one speaks at a time.
```

### `activeTab`

```
Act on the current tab after a click on the extension icon or a context-menu
entry.
```

---

## Data usage declaration (Chrome Web Store)

- Declares **User activity** (anonymous usage events — reading started,
  Supertonic download outcome, extraction failures) as collected, opt-in and
  off by default. Verify the exact category label against the live CWS
  Developer Dashboard form at submission time — the taxonomy shifts
  occasionally.
- Everything else stays **none**.
- Check all three certifications: no sale to third parties, no use outside
  the stated purpose, no use to determine creditworthiness or lending — all
  still true with telemetry opt-in.

## Firefox / AMO

- `data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] }`
  is already declared in the manifest (`wxt.config.ts`).
- **Build instructions** to paste into the dedicated field:

  ```
  Node 24, npm 11.

  npm install
  npm run zip:firefox

  The submitted package is .output/orateur-extension-<version>-firefox.zip.

  Note: public/ort/ is not in the source archive — those three
  onnxruntime-web runtime files are copied from
  node_modules/onnxruntime-web/dist at the start of the build by the
  copyOrtAssets() Vite plugin (see wxt.config.ts).
  ```

- **Notes to the reviewer**:

  ```
  The extension bundles the onnxruntime-web WebAssembly runtime (26 MB,
  unmodified, from the onnxruntime-web npm package) to run the Supertonic
  speech engine locally.

  The ONNX models are not bundled: they're downloaded from the public
  repository https://huggingface.co/Supertone/supertonic-3 only if the user
  enables that engine (the default engine is the system's), and stored in
  the extension's OPFS. These are model weights, not executable code.

  lib/spike-checks.ts and lib/spike-phrase.ts are development test benches
  kept in the repo. They aren't imported by any entrypoint, so they don't
  appear in the built package.

  Optional, opt-in telemetry (lib/telemetry.ts): off by default, no request is
  ever made until the user turns it on from the extension's options page. When
  enabled, a plain fetch() POST goes to PostHog (us.i.posthog.com/i/v0/e/) —
  no posthog-js, no third-party script, nothing beyond a JSON body with an
  event name, a locally-generated random id, and a closed set of properties
  (see PRIVACY.md, "Statistiques d'usage anonymes"). Never page text, never
  URLs.
  ```

---

## Screenshots

Chrome and Edge: at least one at 1280×800. Edge also wants a 300×300 logo.

1. The selection bubble over an article.
2. The reading pill in progress, settings open.
3. The context menu with Orateur's entries.
