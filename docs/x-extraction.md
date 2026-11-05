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

- Posts: absolute links (URLs, `t.co`) and bare `https?://` URLs are dropped.
  Emoji and flags are dropped, because some system voices read their names.
  The hashtags closing a post and the mentions opening a reply are dropped.
  A hashtag or mention inside a sentence is read without its `#` or `@`.
- Articles: the same link, URL and emoji removal, then any block left as a bare
  label ("Link:", "Follow me:") is dropped. `pruneTrailingResidue` is skipped:
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
  characters in the live DOM (`lib/read-anchor.ts`). A post's paragraphs all
  sit in one element, so only the first one can match: the anchor is the whole
  post. Article paragraphs keep their own anchors.
- A logged-out Article has no `lang` attribute and the page language is the
  UI's (`fr` for an English Article). The reader's language detection then
  picks the voice, as it does elsewhere.
- Author threads are not followed: each post is read on its own page.
- Listening checks in Chrome and Firefox, with both engines: see the PR.
