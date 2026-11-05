# X post and Article extraction

Date: 2026-11-05. Scope: what "Read this page" speaks on an X status page
(`x.com/<handle>/status/<id>`): a short post, a long post, a reply, a post
quoting others, an X Article. Design: [docs/superpowers/specs/2026-11-05-x-post-reading-design.md](superpowers/specs/2026-11-05-x-post-reading-design.md).

## Rule

Only the post the URL points at is read. Never the parent of a reply, the
quoted posts, the replies, the author's name and handle, the date, views,
counters or any other app label. Off a status page, or before the post is
rendered, the extension reports "not a readable article". It never falls back
to the page's visible text on X, because that text is the app.

`extract.content.ts` routes `x.com`, `twitter.com`, `mobile.x.com` and
`mobile.twitter.com` to `extractXPost` (`lib/extract-article.ts`).

## Two apps, one URL

| | Logged in | Logged out |
|---|---|---|
| App | react-native-web (`css-*`, `r-*` classes) | Tailwind redesign |
| Post | `article[data-testid="tweet"]` | `article` (no test ids) |
| Post text | `[data-testid="tweetText"]` with `lang` | `div[dir="auto"]`, no `lang` |
| Quotes | inside the post's `article`, under `div[role="link"]` (2nd level `[data-testid="nestedQuotePreview"]`) | nested `article`s with `role="link"`; other posts on the page are wrapped in `role="link"` too |
| Permalink | `a[href="/<handle>/status/<id>"]` around a `<time>` | same href, no `<time>` |
| Article title | `[data-testid="twitter-article-title"]` | `h1` |
| Article body | `[data-testid="twitterArticleRichTextView"]`: Draft.js `div[data-block="true"]`, `h2`, `ul/li`, no `<p>` | `.x-article-body`: `p`, `h3`, `ul/li` |

In both apps a post's paragraphs are `\n` inside one text element, so the
extractor splits lines itself. The post is the first `article` holding a
permalink to the URL's id, and its text is the first text element with no
`article` or `[role="link"]` between it and that `article`. Utility classes
are never matched.

## Cleaning

- Posts: links whose text is an address (full, `host/path`, or shortened by X
  with "…") and bare `https?://` URLs are dropped. Other links keep their
  words: mentions, hashtags and cashtags. Emoji, flags, skin tones and keycap
  marks are dropped, because some system voices read their names. A run of
  hashtags closing a post, after its last sentence or on its own line, is
  dropped. A hashtag ending a sentence ("Allez les #Lions.") is read as a word,
  without its `#`, and so is a mention, without its `@`. A reply's addressee is
  not part of the post text (X shows it apart), so a mention opening a post is
  its subject and stays.
- Articles: the same link, URL and emoji rules. Any block left as a bare label
  ("Link:", "Follow me:") is removed from the tree, so it is neither read nor
  saved. `pruneTrailingResidue` is skipped:
  X authors rarely end a line with a period, and that rule dropped the last
  lines of the Article.
- A post's title is `<display name> : <first line>`, cut on a word at 100
  characters. It labels the pill and the item saved to Orateur, but it is not
  spoken (`announceTitle: false`). An Article's title is spoken as usual.

## Before and after

Measured with the extractor running in Firefox Developer Edition. Logged-out
pages were checked live; logged-in pages from the user's captures (reduced
copies in `tests/fixtures/x/`).

| Page | Before | After |
|---|---|---|
| [Long post](https://x.com/EsBi_Media/status/2117662525101617472) | one block; intro "EsbiMedia (@EsBi_Media) sur X"; `#EsbiMedia` read | 4 paragraphs; no intro, hashtag or emoji |
| [Long post 2](https://x.com/EsBi_Media/status/2118072619425579455) | one block | 4 paragraphs |
| [Post + quote of a quote](https://x.com/RucellVie/status/2117967170156060776) | out: only the truncated 2nd-level quote; in: the app and replies | the opened post only |
| [Short reply](https://x.com/Mikoas237/status/2117686318545146250) | the truncated parent | the reply |
| [Short reply 2](https://x.com/Lumineux59/status/2117703791848120757) | the app ("Post. Se connecter… Vues.") | the reply |
| [X Article](https://x.com/DeRonin_/status/2095180126359105955) | intro "Ronin sur X : « … » / X"; ~115 URLs; last two lines cut | title spoken; no URLs; read to "Hope this was useful for you my fam." |
| [Profile](https://x.com/EsBi_Media) | — | "not a readable article" |

## Limits

- Page highlighting and "read from here" find blocks by their first 80
  characters in the live DOM (`lib/read-anchor.ts`), emoji ignored on both
  sides (the read text has lost the post's leading 🛑). A post's paragraphs all
  sit in one element, so only the first one matches; `blockRange` then lights
  the line where each paragraph starts, up to the next one, matched on letters
  and digits only. "Read from here" inside a post still starts at its first
  paragraph. Article paragraphs keep their own anchors.
- `lib/live-page.ts` never re-reads an element that also holds the next block,
  so a post is not followed through a browser translation. Re-reading the post
  for its first paragraph would speak all of it, then each line again.
- A logged-out Article has no `lang` attribute and the page language is the
  UI's (`fr` for an English Article). The reader's language detection then
  picks the voice, as it does elsewhere.
- Author threads are not followed: each post is read on its own page.
- Listening checks in Chrome and Firefox, with both engines: see the PR.
