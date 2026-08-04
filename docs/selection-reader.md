# Selected-text reading

Select text on any page and have Orateur read it, either via the context
menu or a floating bubble.

## What the feature does — and doesn't do

The extension **contains no reader**. No TTS, no player, no store: its
only job is to extract content and hand it off to the web app, which
already has all of that.

```
Selection → text extraction → validation → URL fragment → /articles/new
```

Reading a selection therefore reuses exactly the same path as saving an
article: `buildImportUrl()` encodes the payload in the fragment,
`/articles/new` reads it via `readExtensionImport()` and pre-fills the
import form. Nothing is duplicated.

## Files

| File | Role |
| --- | --- |
| `lib/selection-text.ts` | DOM extraction → plain text, normalization, validation, truncation. Pure, tested. |
| `lib/bubble-position.ts` | Bubble placement within the viewport. Pure, tested. |
| `lib/handoff.ts` | Adds `textToParagraphHtml()` to the existing code: text → escaped paragraphs. |
| `entrypoints/selection.content.ts` | Selection detection, floating bubble, response to the background. |
| `entrypoints/background.ts` | Context-menu entry, action handling, opening the reader. |

## The two flows

**Context menu** — the "Read with Orateur" entry is declared with
`contexts: ["selection"]`, so the browser only shows it on a selection.
On click, the background script queries the content script of the
relevant frame (`info.frameId`) for clean text, and falls back to
`info.selectionText` if the script isn't there.

**Floating bubble** — the content script listens for `mouseup`,
`mousedown` and `keyup` on the document. On release, it reads the
selection on the next tick (it isn't settled yet), and shows the bubble.
Clicking it sends
`{ type: "orateur:selection-action", action: "read", text, title, lang }`
to the background.

## Decisions

**Text travels escaped, as HTML paragraphs.** On the web side,
`createStoredArticleFromImport` treats `content` as HTML as soon as it
spots markup: sending raw text would let a selected `<div>` from a docs
page slip through. `textToParagraphHtml()` escapes `&`, `<` and `>` and
wraps each block in a `<p>` — the trip is reversible and no fragment of
the page can come back as markup. The selection is treated as untrusted
data end to end; nothing is ever built with `innerHTML`.

**The bubble costs access to all pages.** The rest of the extension runs
on `activeTab` alone, with no install-time warning. The bubble has to be
present *before* the user's gesture, so its content script declares
`matches: ["<all_urls>"]` — which triggers the "read and change your data
on all websites" warning. The context menu, on the other hand, costs
nothing. Removing the bubble would make the permission unnecessary; the
reverse isn't true.

**An in-progress read isn't handled here.** Every action opens a tab to
`/articles/new`, just like saving an article. Orateur is the one that
arbitrates — the extension has no reading state to consult and shouldn't
invent one.

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
| Same-origin **and** cross-origin iframes | Works: `allFrames: true` gives each frame its own instance, no crossing boundaries. |
| Open shadow DOM | Works, selection passes through. |
| Closed shadow DOM | Selection isn't exposed by the browser; the bubble doesn't show. |
| PDF viewer | No content script runs there. The context menu falls back to `info.selectionText`. |
| Google Docs | Text is painted on a canvas, nothing selectable in the DOM sense. No effect. |
| `<input>` / `<textarea>` | Supported via `selectionStart`/`selectionEnd`; the bubble anchors to the field. |
| `contenteditable` (Notion, CMS) | Supported through the normal path. |
| Internal pages (`about:`, extension stores) | No content script possible, by browser design. |
| SPAs (React, Vue, Angular) | No dependency on the initial DOM: listeners are on `document`, client-side navigation breaks nothing. |
| Selection > 20,000 characters | Truncated at a word boundary, with a warning badge. Never rejected. |

## Adding an action

"Translate", "Summarize", "Save":

1. Add an entry to `ACTIONS` in `entrypoints/selection.content.ts`.
2. Add a case to the background's `if (message.action === …)`.

The bubble and context menu carry no business logic: they pass along an
action id and text.

## Tests

`npm test` covers extraction (paragraphs, inline styles, lists, tables,
links, inert elements, `<br>`, Unicode/emoji), validation (empty,
whitespace-only, minimum length, truncation without breaking a surrogate
pair), Firefox's multiple ranges, HTML escaping, and bubble placement
(top/bottom flip, left/right clamping, viewport smaller than the
bubble).

The rest — the bubble actually appearing, the reader opening — is
manual: `npm run dev`, then the scenarios in the limitations table
above.
