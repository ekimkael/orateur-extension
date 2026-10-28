# Gmail newsletter extraction — audit

Date: 2026-10-16. Scope: what "Read this page" speaks when the open tab is a
Gmail message, with a focus on newsletters.

## Method

The extraction code was bundled standalone (`lib/extract-article.ts`, same
`extractArticle` → `visibleText` fallback as `entrypoints/extract.content.ts`)
and run on 8 real messages in the user's Gmail (Chrome). For each one, the
spoken text was compared, block by block, with the visible message body
(`.a3s` elements, the Gmail message container).

- "outside": spoken blocks absent from the message body (Gmail UI, other mails).
- "missing": body lines absent from the spoken text.

Caveat: Gmail enforces Trusted Types. Readability's retry path
(`body.innerHTML = cache`) throws in the page world. Measurements were taken
with a permissive policy to mimic an extension's isolated world — see finding 3.

## Pipeline recap

1. `background.ts` → `extractFromTab` injects `extract.js` in the main frame
   (retry on all frames after 700 ms if it fails).
2. `extractArticle(document)`: clones the **whole Gmail document**, strips
   `INERT_SELECTORS` + `NOISE_PATTERN`, gate `isProbablyReaderable`, then
   Readability (`charThreshold: 120`) picks the best-scoring block.
3. On throw: `visibleText(document)` flattens the **whole cloned body** (≥ 400 chars).
4. Text goes to `reader.content.ts` with `title` (Readability's title, i.e.
   the tab title minus the account suffix).

Nothing is Gmail-aware: the message is found only if Readability happens to
score it highest among the whole Gmail UI.

## Results

| Newsletter | Path | Spoken / body (chars) | Verdict |
|---|---|---|---|
| ByteByteGo (Substack) | article | 813 / 1966 | Good: 3 prose paragraphs; header, "latest articles", paywall CTA, footer skipped. Lost: "In this article" outline list. |
| Medium Weekly Digest | article | **125 / 2530** | **Broken**: one story teaser, title glued to excerpt ("…Deterministic LoopI was using Claude"). 10+ stories ignored. |
| DEV Digest | article | 3532 / 4112 | Good: all stories. Noise: "DEV Digest.", "PROMOTED.". |
| PlanetHoster Insights (FR) | article | 9466 / 9753 | Good: full content, only CTAs dropped. Bug: "Cher client,." |
| Substack (On Substack) | article | 2821 / 3311 | Good. Footer, share buttons dropped. |
| Free-Work (FR) | article | 2065 / 2466 | Usable but choppy: each table cell is a sentence ("Freelance. Expert cyber/SOC. 500 - 550 €⁄j. Lille."). |
| Hidden Jobs (FR, Substack) | article | 5081 / 5352 | Good, but Gmail **clipped** the message ("[Message tronqué]"): the end is silently never read. |
| Inbox (no message open) | article | 29 826 | **Broken**: reads Gmail UI + every inbox row ("Ce message a été classé dans les messages importants par Google. Cliquer ici…"). |

Never spoken (good): Gmail chrome around the message — sender, date, "to me",
labels, toolbar. Footers, unsubscribe, legal address, share/like buttons, and
most CTAs ("Postuler", "Voir l'article") are dropped too.

## Findings

1. **Readability is the wrong tool on Gmail** (Medium). It scores blocks across
   the whole app; on a link-dense digest of short cards, a single `h2` wins and
   passes the 120-char threshold. Result is worse than the fallback would be.
2. **Inbox view reads the whole UI.** No guard for "no message open".
3. **Trusted Types risk (to verify in Firefox).** When Readability's first pass
   is under threshold it restores `body.innerHTML` from a string. In the page
   world Gmail rejects that; the fallback then speaks ~35 000 chars of Gmail UI.
   Extension isolated worlds should not be subject to the page's Trusted
   Types, but neither Chrome nor Firefox was checked with the real extension. Quick check: in Firefox, open the Medium
   digest, press play — if it starts with "Si vous rencontrez des problèmes de
   chargement…", it is hit.
4. **Clipped messages** (Gmail cuts at ~102 KB) are read partially, silently.
5. **`withStop` adds a period after a comma** ("Cher client,."): `,` and `;`
   are missing from its punctuation class in `lib/reading-intro.ts`.
6. **Table layouts fragment** into one sentence per `td` (job boards, pricing).
   Low priority.

## Recommendations (smallest first)

1. Scope extraction to the message on Gmail (fixes 1, 2, 3): in
   `extract.content.ts`, when `location.hostname === "mail.google.com"`, take
   the visible `.a3s` elements; none → return the "not an article" error
   (inbox); otherwise flatten them with the same `toSpeakableText` path as
   `visibleText` (skip Readability), title from `h2.hP`. `.a3s` is obfuscated
   but has been stable for years and is what most Gmail extensions use;
   it is a known ceiling.
2. Add `,;` to the `withStop` class — or strip a trailing comma before adding
   the period.
3. When `.iX` (clipped notice) is present, notify "message truncated by Gmail"
   like `noticeSelectionTruncated`.
4. Optional: merge consecutive short `td` cells of one row into a single
   sentence.

## Status — recommendations 1 to 3 implemented

- `extractGmailMessage` (`lib/extract-article.ts`), called by
  `extract.content.ts` on `mail.google.com`, with no visible-text fallback.
  It copies the `.a3s` bodies into a fresh document (`importNode`, no HTML
  string), drops the clipped notice and `display:none` preheaders, runs
  Readability on the message alone, and keeps its pick only if it retains at
  least 30 % of the message text; otherwise (digests, job lists, not
  readerable, Readability error) it reads the whole message. Title = subject,
  `lang` = Gmail's UI language as a prior only: `resolveDocLang`
  (`lib/detect-lang.ts`) lets the text override it when detection is
  clear, for the AI voice as for the system voice. A `null` lang made the AI
  voice drop to `speechSynthesis` on terse mails where detection is
  indecisive (Free-Work job list).
- `truncated` flag → `noticeMessageTruncated` notification (read and save).
- `withStop` turns a trailing `,`/`;` into the period.

Re-measured on the same mailbox (page world, Chrome):

| Message | Before | After |
|---|---|---|
| Inbox | 29 826 chars of UI | refused ("not an article") |
| Medium Weekly Digest | 125 chars, one teaser | 2 530, every card (plus "Stories for…" header lines) |
| ByteByteGo | 813 | 813 (Readability kept) |
| DEV Digest | 3 532 | 3 532 |
| PlanetHoster | "Cher client,." | "Cher client." |
| Hidden Jobs | 5 081, clipping silent | 5 284, clipping notified; not readerable → whole message, so 5–6 header lines ("LIRE DANS L'APP", date) are read |
| Substack, Free-Work | unchanged | unchanged |

Quoted replies in threads: Gmail folds the quoted history of each reply in a
`.adL` block hidden by its stylesheet; the copy used to read it, repeating the
whole thread in every message (a 5-message thread: 11–1 040 visible chars per
body, 1 140–4 630 read). Folded `.adL` blocks are now dropped, decided on the
live layout before copying, so history unfolded with "…" is still read.
Newsletters also carry empty, visible `.adL` blocks, which stay. Measured:
spoken text per message now matches what Gmail shows (18/18, 156/158 chars…).

The real extension was tried in Firefox after these changes (AI voice on a
Gmail newsletter). Trusted Types no longer matter here: Readability only runs
on a detached copy of the message, and any error falls back to the whole
message.

Sponsor cards: newsletter markup carries no class to match, so a card is
found by its printed label ("PROMOTED" on DEV Digest, "Sponsored by…",
"Together with…", "Publicité"…). `removeSponsorCards` climbs from the label to
the box holding label and pitch, and drops it before Readability or the
whole-message fallback sees it. A box over half the message is taken for the
layout: only the label is dropped then.
