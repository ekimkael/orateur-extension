/**
 * Per-site cleanups of a page copy, before Readability scores it. Each rule
 * was verified on live articles; see docs/extraction-audit.md. To support a
 * new site, add one entry to `SITE_CLEANUPS` with a fixture test.
 */

import { normalize, remove } from "./dom.ts"

/**
 * What a rule hands back. `lead` and `caption` are prepended to `body` when
 * the CMS places them outside the scored article; `completeBody` is a curated
 * body of sections and references, read whole.
 */
export interface SiteParts {
  lead?: Element | null
  body?: Element | null
  caption?: Element | null
  completeBody?: Element | null
}

/** Cleans `doc`, a copy of one site's page; `original` is the live page, for layout checks. */
export type SiteCleanup = (doc: Document, original: Document, host: string) => SiteParts | void

function wikipedia(doc: Document) {
  remove(doc, ".reference,.mw-ref,.reflist,.mw-references-wrap,.references,.mw-editsection,.bandeau-portail,.navbox")
  for (const heading of doc.querySelectorAll(".mw-heading")) heading.replaceWith(...heading.childNodes)
}

/**
 * BBC splits prose into layout divs. Their legitimate source links exceed
 * Readability's 20% link-density limit for unweighted layout containers.
 */
function bbc(doc: Document) {
  for (const block of doc.querySelectorAll("article div")) block.classList.add("article-body")
  for (const p of doc.querySelectorAll("article p")) {
    if (/^Sign up\b/i.test(p.textContent?.trim() ?? "") && p.querySelector("a[href*='newsletters'],a[href*='Newsletter_Signup']")) p.remove()
  }
}

/** ZDNET and CNET share one CMS, with a caption on CNET and inline promos on ZDNET. */
function ziffDavis(doc: Document, _original: Document, host: string): SiteParts {
  remove(doc, ".wp-block-ziff-davis-exco-video")
  const lead = doc.querySelector(".entry-excerpt")
  const body = doc.querySelector(".entry-content")
  const caption = host === "cnet.com" ? doc.querySelector("figure.post-thumbnail figcaption") : null
  if (host === "zdnet.com") {
    for (const p of doc.querySelectorAll(".entry-content > p")) {
      const text = normalize(p.textContent ?? "")
      const link = p.querySelector("a")
      if (/^Follow ZDNET:/.test(text) || (link && text === `Also: ${normalize(link.textContent ?? "")}`)) p.remove()
    }
  }
  return { lead, body, caption }
}

function tomsHardware(doc: Document, original: Document): SiteParts {
  remove(doc, "#article-body .vid-present,.author__bio-wrapper,#article-body p:has(a[href*='news.google.com'])")
  const lead = doc.querySelector(".strapline")
  const body = doc.querySelector("#article-body")
  // Kiosq sometimes leaves aria-hidden on prose that is fully visible.
  // Trust live layout only, with no active barrier or obscured ancestor.
  if (!original.querySelector(".hasBarrier,.kiosq-main-layer")) {
    const selector = "#article-body .kiosq-b[aria-hidden='true']"
    const copies = doc.querySelectorAll(selector)
    original.querySelectorAll(selector).forEach((p, index) => {
      let visible = p.getClientRects().length > 0
      for (let el: Element | null = p; visible && el; el = el.parentElement) {
        const style = original.defaultView?.getComputedStyle(el)
        visible = !!style && style.display !== "none" && style.visibility !== "hidden" &&
          style.visibility !== "collapse" && style.opacity !== "0" && (!style.filter || style.filter === "none")
      }
      if (visible) copies[index]?.removeAttribute("aria-hidden")
    })
  }
  return { lead, body }
}

function healthline(doc: Document): SiteParts {
  remove(doc, ".icon-hl-trusted-source-after > .sro,a.icon-hl-pinterest")
  return { completeBody: doc.querySelector("article.article-body") }
}

function howToGeek(doc: Document) {
  remove(doc, ".article-header-data .with-excerpt[data-nosnippet]")
}

/**
 * Rules by hostname, without `www.`. A Map rather than an object literal: a
 * lookup must never find an inherited key such as "constructor".
 */
export const SITE_CLEANUPS = new Map<string, SiteCleanup>([
  ["franceinfo.fr", (doc) => remove(doc, ".generic-vertical-rebound,.shuffle-videos,.media-embed:has(.card-article-list-xs),.preferred-source")],
  ["bbc.com", bbc],
  ["bbc.co.uk", bbc],
  ["numerama.com", (doc) => remove(doc, ".embed-consent-overlay,.embedded-tag-container")],
  ["techcrunch.com", (doc) => remove(doc, ".affiliate-disclaimer-text")],
  ["theverge.com", (doc) => {
    const entry = doc.querySelector(".duet--layout--entry-body")
    const blocks = entry?.querySelectorAll(".duet--article--article-body-component")
    if (blocks?.length) entry!.replaceChildren(...blocks)
  }],
  ["aljazeera.com", (doc) => remove(doc, ".more-on,.nudge")],
  ["dw.com", (doc) => {
    remove(doc, ".vjs-wrapper,.rich-text p:has(a[href^='https://www.google.com/preferences/source'])")
    return { lead: doc.querySelector(".teaser-text"), body: doc.querySelector(".rich-text") }
  }],
  ["channelnewsasia.com", (doc) => remove(doc, ".mc-text-to-speech-wrapper")],
  ["npr.org", (doc) => remove(doc, ".anti-fraud-message,#storytext .caption .credit,#storytext .hide-caption")],
  ["abc.net.au", (doc) => remove(doc, "[data-component='PrintTimestamp']")],
  ["wired.com", (doc) => {
    remove(doc, ".journey-unit__container")
    // Public WIRED articles also mark normal prose with this class.
    for (const p of doc.querySelectorAll(".body__inner-container p.paywall")) p.classList.remove("paywall")
  }],
  ["zdnet.com", ziffDavis],
  ["cnet.com", ziffDavis],
  ["thenextweb.com", (doc) => {
    remove(doc, "#nl-container")
    const lead = doc.querySelector(".c-header__intro")
    const caption = doc.querySelector(".c-article__figcaption")
    const body = doc.querySelector("#article-main-content")
    lead?.removeAttribute("class")
    if (caption) caption.textContent = normalize(caption.textContent ?? "")
    return { lead, caption, body }
  }],
  ["mashable.com", (doc) => {
    remove(doc, "#article ~ section:has(.editor-content),#article > p:has(a[href='https://mashable.com/newsletters']):has(a[href='https://mashable.com/life/how-to-set-up-mashable-push-notifications'])")
    const lead = doc.querySelector("article header > h1 + div")
    const caption = doc.querySelector("article img + div:has(> span)")
    const body = doc.querySelector("#article")
    for (const quote of doc.querySelectorAll("blockquote.twitterEmbed")) {
      if (normalize(quote.textContent ?? "") === "This Tweet is currently unavailable. It might be loading or has been removed.") quote.remove()
    }
    return { lead, caption, body }
  }],
  ["techradar.com", (doc) => {
    remove(doc, ".kwizly-quiz,.author__bio-wrapper,#article-body p:has(a[href*='news.google.com'])")
    const body = doc.querySelector("#article-body")
    const title = doc.querySelector("h1")
    if (title && body) {
      // A different SEO title makes Readability mistake an actual section
      // heading for a duplicate. Let it remove the real headline instead.
      doc.querySelector('meta[property="og:title"]')?.setAttribute("content", normalize(title.textContent ?? ""))
      body.prepend(title)
    }
    return { body }
  }],
  ["tomshardware.com", tomsHardware],
  ["pcworld.com", (doc) => {
    remove(doc, ".affiliate-disclaimer")
    return { lead: doc.querySelector("h2.content-subheadline"), body: doc.querySelector("article .for-toc .article-column__content") }
  }],
  ["howtogeek.com", howToGeek],
  ["xda-developers.com", howToGeek],
  ["androidcentral.com", (doc) => remove(doc, ".author__default-layout")],
  ["macrumors.com", (doc) => {
    const articles = doc.querySelectorAll("article.js-article")
    if (articles.length === 1 && articles[0]!.querySelector(".js-content")) {
      doc.body.replaceChildren(articles[0]!)
      remove(doc, ".linkback")
    }
  }],
  ["nhs.uk", (doc) => {
    const body = doc.querySelector("main#maincontent article")
    return { lead: doc.querySelector(".nhsuk-lede-text"), body, completeBody: body }
  }],
  ["my.clevelandclinic.org", (doc) => {
    remove(doc, "[data-identity='subscription-card'],[data-identity='social-share-links'],[data-identity='inline-cta-panel'],[data-identity='ad-policy'],[data-identity='billboard-ad'],[class~='hidden'][class~='print:block']")
    return { completeBody: doc.querySelector("[data-identity='main-article-content']") }
  }],
  ["medlineplus.gov", (doc) => {
    remove(doc, "#toc-section")
    const body = doc.querySelector("article .main")
    return { lead: doc.querySelector(".page-title .alsocalled"), body, completeBody: body }
  }],
  ["healthline.com", healthline],
  ["medicalnewstoday.com", healthline],
  ["webmd.com", (doc) => {
    remove(doc, ".google-preferences-module")
    const completeBody = doc.querySelector(".article__body")
    const sources = doc.querySelector(".sources-section .sources-wrapper")
    if (completeBody && sources && !completeBody.contains(sources)) completeBody.append(sources)
    return { completeBody }
  }],
  ["health.harvard.edu", (doc) => {
    const completeBody = doc.querySelector(".content-repository-content")
    for (const p of doc.querySelectorAll("article p.font-semibold.mt-2")) {
      if (completeBody && normalize(p.textContent ?? "").startsWith("No content on this site, regardless of date,")) completeBody.append(p)
    }
    return { completeBody }
  }],
  ["psychologytoday.com", (doc) => {
    remove(doc, ".pt-ad")
    const sections = doc.querySelectorAll(".reference__body,.reference__sections")
    if (!sections.length) return
    const completeBody = doc.createElement("article")
    for (const section of sections) if (!completeBody.contains(section)) completeBody.append(section)
    doc.body.append(completeBody)
    return { completeBody }
  }],
  ["sleepfoundation.org", (doc) => {
    remove(doc, "#cc-main,.ipn-scroll,.email-capture,.post-list,.hst-cta,[data-block-name='acf/post-list'],.blockquote-8:has(a[href^='https://community.sleepfoundation.org'])")
    const completeBody = doc.querySelector("#post_content")
    const references = doc.querySelector(".references-section")
    if (completeBody && references && !completeBody.contains(references)) completeBody.append(references)
    return { completeBody }
  }],
  ["france24.com", (doc) => {
    remove(doc, ".a-read-more,.m-em-video")
    return { lead: doc.querySelector(".t-content__chapo"), body: doc.querySelector(".t-content__body") }
  }],
  ["jeuneafrique.com", (doc) => {
    remove(doc, ".article-data,.box-read")
    return { lead: doc.querySelector(".headline__lead"), body: doc.querySelector('[data-mrf-recirculation="Corps d\'article"]') }
  }],
])

/** The rule for a hostname, with or without `www.`; Wikipedia covers every language. */
export function siteCleanup(hostname: string): SiteCleanup | undefined {
  const host = hostname.replace(/^www\./, "")
  return host.endsWith(".wikipedia.org") ? wikipedia : SITE_CLEANUPS.get(host)
}
