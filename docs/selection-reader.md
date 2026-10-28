# Selected-text reading

Select text on a supported page and have Orateur read it, either via the context
menu or a floating bubble. Two actions, but only the context menu offers both:

- **Read** — read the selection out loud right there, on the page. Same
  pastille, same engines (system voice or Supertonic), as "Read this page"
  (see `entrypoints/reader.content.ts`). Available from the
  bubble and the context menu.
- **Read later** — hand the selection off to the Orateur web app, to listen
  to whenever. This action transfers the selected content to the web app.
  Context menu only: the bubble is a shortcut for reading right away, not a
  queue manager.

In-place reading does not send the selected text to the Orateur web app.
Supertonic requires an initial model download; browser system voices may use
their provider's online service. Configured usage analytics follow the privacy
setting and exclude selected text. See [privacy](../PRIVACY.md).

## What the feature does — and doesn't do

Reading in place reuses the extension's own reader: `read()` in
`entrypoints/background.ts` sends `START_READING` to the tab's content
script, exactly like reading the whole page.

Reading later reuses the same path as saving an article — the extension
**contains no store** for it, just a handoff:

```
Selection → text extraction → validation → URL fragment → /articles/new
```

`buildImportUrl()` encodes the payload in the fragment, `/articles/new`
reads it via `readExtensionImport()` and pre-fills the import form.
Nothing is duplicated with the article-saving flow.

## Files

| File | Role |
| --- | --- |
| `lib/selection-text.ts` | DOM extraction → plain text, normalization, validation, truncation. Pure, tested. |
| `lib/bubble-position.ts` | Bubble placement within the viewport. Pure, tested. |
| `lib/handoff.ts` | Builds import URLs and converts text into escaped HTML paragraphs. |
| `entrypoints/selection.content.ts` | Selection detection, floating bubble, response to the background. |
| `entrypoints/background.ts` | Context-menu entry, action handling, opening the reader. |

## The two entry points

**Context menu** — "Read with Orateur" and "Listen to selection later" are
both declared with `contexts: ["selection"]`, so the browser only shows
them on a selection. On click, the background script queries the content
script of the relevant frame (`info.frameId`) for clean text, and falls
back to `info.selectionText` if the script isn't there.

**Floating bubble** — the content script listens for `mouseup`,
`mousedown` and `keyup` on the document. On release, it reads the
selection on the next tick (it isn't settled yet), and shows the bubble
with its single "Read" button. Clicking it sends
`{ type: "orateur:selection-action", action: "read", text, truncated, title, lang }`
to the background, which routes to `read()`. The message shape still
carries `action: "read" | "save"`; context-menu clicks call
`selectionFromMenu()` directly, which routes to the same reading and saving
functions.

## Decisions

**Text travels escaped, as HTML paragraphs — on the "Read later" path.** On
the web side,
`createStoredArticleFromImport` treats `content` as HTML as soon as it
spots markup: sending raw text would let a selected `<div>` from a docs
page slip through. `textToParagraphHtml()` escapes `&`, `<` and `>` and
wraps each block in a `<p>` — the trip is reversible and no fragment of
the page can come back as markup. The selection is treated as untrusted
data end to end; nothing is ever built with `innerHTML`.

**The bubble and reader require website access.** Both content scripts
declare `matches: ["<all_urls>"]` so their controls are available before
the user's gesture. The manifest also requests `<all_urls>` host access
so the reading pill can trigger article extraction. `activeTab` remains
available for toolbar and context-menu gestures when website access is
restricted to clicks. Removing the bubble alone would not remove the
permission requirement.

**Site exclusions suppress the bubble at page load.** The bubble reads
Settings → Sites when its content script starts. Reload the page after
changing an exclusion to update the bubble; it does not subscribe to those
changes. Its color theme does follow settings changes immediately.

**"Read later" doesn't check for an in-progress read.** It always opens a
tab to `/articles/new`, just like saving an article. Orateur is the one
that arbitrates — the extension has no reading state to consult there and
shouldn't invent one. "Read," on the other hand, goes through the same
`READER_TOKEN` coordination as reading the whole page: starting it stops
whatever another tab was reading (see `entrypoints/reader.content.ts`).

**Three permanent listeners, not one more.** No `MutationObserver`, no
`selectionchange` (which fires on every caret move), no periodic
recompute. The volatile listeners — `scroll`, `blur`,
`visibilitychange` — are only wired up while the bubble is visible and
are removed with a single `AbortController.abort()`.

**Viewport coordinates + `position: fixed`.** `getBoundingClientRect()`
already accounts for scroll, browser zoom and pixel ratio. Placement
doesn't need to know about any of that, which makes `placeBubble()`
purely arithmetic and testable.

## Bubble lifecycle

It disappears on: click elsewhere (`mousedown` outside the host), new
selection, empty selection, `Escape`, scroll, window blur, tab change,
and extension-context invalidation.

It doesn't block selection: the button's `mousedown` calls
`preventDefault()` so the caret doesn't move, and the host is
`position: fixed`, out of the page flow.

## Accessibility

The button is a native `<button>` inside a shadow root — so it already
has `role="button"`, Enter/Space activation, and keyboard navigation,
with no redundant ARIA. A full `aria-label` replaces the short label.
Focus is never stolen: taking it would clear the selection.
`prefers-reduced-motion` removes the appear animation.

## Known limitations

| Situation | Behavior |
| --- | --- |
| Same-origin **and** cross-origin iframes | Bubble and text extraction work: `allFrames: true` gives each frame its own instance. "Read" plays fine too, but the reading pill lives in the main frame, so the paragraph-follow highlight (`createFollower` in `entrypoints/reader.content.ts`) can't find the source element there — `findAnchor` returns `null` and nothing gets painted, same as any unmatched block. |
| A selection starting mid-paragraph | Reads and saves fine — the extracted text just starts wherever the selection did. The follow highlight won't necessarily find the exact same substring in the DOM; same "no match, nothing painted" fallback as above. |
| Shadow DOM | Depends on what the browser exposes through `window.getSelection()` and cloned ranges; closed roots are not traversed. |
| Built-in PDF viewer | No content script runs there, so the bubble is unavailable. If the browser exposes selected text to the context menu, "Listen to selection later" can send it to Orateur. In-place "Read" cannot reach the reading pill and reports `errorPageNotInjectable`. For document reading, use the separate [PDF companion](pdf-reader.md). |
| Google Docs | Text is painted on a canvas, nothing selectable in the DOM sense. No effect. |
| `<input>` / `<textarea>` | Supported when the field exposes `selectionStart`/`selectionEnd`; the bubble anchors to the field. Input types such as `number` and `email` do not expose this API. |
| `contenteditable` (Notion, CMS) | Supported through the normal path. |
| Internal pages (`about:`, extension stores) | No content script possible, by browser design. |
| SPAs (React, Vue, Angular) | No dependency on the initial DOM: listeners are on `document`, client-side navigation breaks nothing. |
| Selection shorter than 3 UTF-16 code units after normalization | No bubble; the context-menu action reports an empty or too-short selection. |
| Selection > 20,000 UTF-16 code units | Truncated at a nearby word boundary when available; otherwise cut without splitting a surrogate pair. A warning badge reports truncation. |

## Tests

`npm test` covers extraction (paragraphs, inline styles, lists, tables,
links, inert elements, `<br>`, Unicode/emoji), validation (empty,
whitespace-only, minimum length, truncation without breaking a surrogate
pair), Firefox's multiple ranges, HTML escaping, and bubble placement
(top/bottom flip, left/right clamping, viewport smaller than the
bubble).

Production-package browser tests now cover mouse selection, bubble activation
and the selected text reaching the speech engine. After building the Chrome
and Firefox ZIPs, run `npm run test:e2e` and `npm run test:e2e:firefox`.
The speech engine is simulated; these tests do not prove audible playback.

Check iframe selections, editable fields, built-in PDF viewer behavior and
actual audio manually with `npm run dev` or `npm run dev:firefox`.
See [testing](testing.md) for browser installation and package prerequisites.
