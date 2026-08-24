# Selected-text reading

Select text on any page and have Orateur read it, either via the context
menu or a floating bubble. Two actions, both available in both places:

- **Read** — read the selection out loud right there, on the page. Same
  pastille, same engines (system voice or Supertonic), as "Read this page"
  (see `entrypoints/reader.content.ts`). No network call.
- **Read later** — hand the selection off to the Orateur web app, to listen
  to whenever. This is the only path of the two that leaves the browser.

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
| `lib/handoff.ts` | Adds `textToParagraphHtml()` to the existing code: text → escaped paragraphs. |
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
with both buttons. Clicking one sends
`{ type: "orateur:selection-action", action: "read" | "save", text, title, lang }`
to the background, which routes to `read()` or `saveSelection()`.

## Decisions

**Text travels escaped, as HTML paragraphs — on the "Read later" path.** On
the web side,
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
| Open shadow DOM | Works, selection passes through. |
| Closed shadow DOM | Selection isn't exposed by the browser; the bubble doesn't show. |
| PDF viewer | No content script runs there, so neither the bubble nor "Read" is available. The context menu still shows both entries, falling back to `info.selectionText`: "Listen to selection later" opens Orateur as usual, but "Read" can't reach a pastille to read with and shows the `errorPageNotInjectable` badge instead. |
| Google Docs | Text is painted on a canvas, nothing selectable in the DOM sense. No effect. |
| `<input>` / `<textarea>` | Supported via `selectionStart`/`selectionEnd`; the bubble anchors to the field. |
| `contenteditable` (Notion, CMS) | Supported through the normal path. |
| Internal pages (`about:`, extension stores) | No content script possible, by browser design. |
| SPAs (React, Vue, Angular) | No dependency on the initial DOM: listeners are on `document`, client-side navigation breaks nothing. |
| Selection > 20,000 characters | Truncated at a word boundary, with a warning badge. Never rejected. |

## Adding an action

"Translate", "Summarize", and the like:

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
