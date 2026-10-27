import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

// Contenus synthétiques : ces tests vérifient l'extraction, pas des conseils médicaux.
const TITLE = "An educational guide with safety notices and source references"
const PROSE = [
  "This educational article explains how its information is organized and reviewed. Its introductory section gives readers the context they need before consulting the later sections, which contain separate safety notices and links to supporting sources.",
  "The next section describes the subject in more detail and identifies the limits of the information presented. The wording of each notice belongs to the article and must remain next to the surrounding explanation when the page is prepared for reading.",
  "The final section explains how the publication maintains its educational material over time. Readers can consult the named sources and review information at the end of the article without losing the earlier context or the notices attached to individual sections.",
]

function extractAt(url: string, html: string) {
  const doc = new JSDOM(`<!doctype html><html lang="en"><head><title>${TITLE}</title></head>
    <body>${html}</body></html>`, { url }).window.document
  const original = doc.documentElement.outerHTML
  const article = extractArticle(doc)
  assert.equal(doc.documentElement.outerHTML, original, "source DOM remains unchanged")
  return article.textContent
}

function assertOrder(text: string, blocks: string[]) {
  let previous = -1
  for (const block of blocks) {
    const position = text.indexOf(block)
    assert.ok(position > previous, `missing or reordered block: ${block}`)
    previous = position
  }
}

test("NHS conserve introduction, trois encadrés de soins et références sur les médicaments", () => {
  const lead = "The introduction explains the purpose of this educational guide and provides context for the safety notices and reference material that follow."
  const warnings = [
    ["non-urgent", "Non-urgent advice:", "The non-urgent notice remains attached to the article."],
    ["urgent", "Urgent advice:", "The urgent notice retains its complete wording and position."],
    ["emergency", "Immediate action required:", "The emergency notice must not disappear during extraction."],
  ]
  const references = ["Medicine reference from the external foundation", "Find the medicine in the NHS reference directory"]
  const text = extractAt("https://www.nhs.uk/conditions/example/", `<main id="maincontent">
    <div class="nhsuk-grid-row"><h1>${TITLE}</h1><p class="nhsuk-lede-text">${lead}</p></div>
    <article><h2>Introduction to the guide</h2><p>${PROSE[0]}</p>
      ${warnings.map(([kind, heading, message]) => `<div class="nhsuk-card nhsuk-card--care nhsuk-card--care--${kind}">
        <h3>${heading}</h3><ul><li>${message}</li></ul></div>`).join("")}
      <p>${PROSE[1]}</p><div class="nhsuk-inset-text"><span class="nhsuk-u-visually-hidden">Information: </span>
        <h3>More about medicines</h3><ul><li><a href="https://foundation.example/medicine/">${references[0]}</a></li>
        <li><a href="/medicines/">${references[1]}</a></li></ul></div>
      <p>${PROSE[2]}</p>
    </article></main>`)

  assertOrder(text, [lead, PROSE[0], ...warnings.flatMap(([, heading, message]) => [heading, message]), PROSE[1], "More about medicines", ...references, PROSE[2]])
})

test("Cleveland Clinic conserve toutes les sections, mises en garde et sources ouvertes sans la copie impression", () => {
  const sections = ["Overview", "Symptoms and Causes", "Diagnosis and Tests", "Management and Treatment", "Outlook / Prognosis"]
  const paragraphs = sections.map((heading, index) => `${heading}: section ${index + 1} of the educational guide. ${PROSE[index % PROSE.length]}`)
  const warning = "This safety notice belongs to the treatment section and must remain in the extracted article."
  const note = "This closing note is part of the educational material, alongside the sources and review information."
  const citations = ["Source One. Review methods for educational health material.", "Source Two. Keeping safety notices connected to their explanations."]
  const text = extractAt("https://my.clevelandclinic.org/health/diseases/example", `<h1>${TITLE}</h1>
    <div data-identity="main-article-content">
      ${sections.map((heading, index) => `<div><div data-identity="article-section" class="scroll-mt-[112px]" id="section-${index}">
        <h2 data-identity="headline">${heading}</h2><div data-identity="rich-text"><p>${paragraphs[index]}</p></div>
        ${index === 3 ? `<div data-identity="callout-container"><p>${warning}</p></div>` : ""}
      </div></div>`).join("")}
      <h3 data-identity="headline">A note from Cleveland Clinic</h3><div data-identity="rich-text"><p>${note}</p></div>
      <div data-identity="subscription-card"><p>Subscribe to the promotional email list.</p></div>
      <section><h3>References</h3><section data-identity="medical-review-disclaimer"><p>Medically reviewed educational material.</p></section>
        <section data-identity="collapsible-content-section"><h4><button>View Sources</button></h4>
          <div data-identity="rich-text"><ul>${citations.map(citation => `<li>${citation}</li>`).join("")}</ul></div>
        </section></section>
      <div class="hidden print:block"><h3>References</h3><ul>${citations.map(citation => `<li>${citation}</li>`).join("")}</ul></div>
      <div data-identity="billboard-ad"><p>Advertisement</p></div>
    </div>`)

  assertOrder(text, [...sections.flatMap((heading, index) => index === 3 ? [heading, paragraphs[index], warning] : [heading, paragraphs[index]]), "A note from Cleveland Clinic", note, ...citations])
  for (const citation of citations) assert.equal(text.split(citation).length - 1, 1)
  assert.doesNotMatch(text, /Subscribe to the promotional|Advertisement|View Sources/)
})

test("MedlinePlus conserve résumé, tableau et groupes de références sans le sommaire de navigation", () => {
  const alias = "Also called: Example topic A, Example topic B"
  const groups = ["Symptoms", "Treatments and Therapies", "Journal Articles"]
  const references = ["Safety notice from an independent medical foundation", "Reference material about educational treatment information", "Journal article reviewing the published evidence"]
  const text = extractAt("https://medlineplus.gov/exampletopic.html", `<article>
    <div class="page-title"><h1>${TITLE}</h1><span class="alsocalled">${alias}</span></div>
    <div class="main"><section id="toc-section"><h2>On this page</h2><ul><li><a href="#topsum_section">Navigation entry only</a></li></ul></section>
      <section id="topsum_section"><h2>Summary</h2><div id="topic-summary" class="syndicate">
        <h3>Understanding the guide</h3><p>${PROSE[0]}</p>
        <table class="info-table-1"><thead><tr><th>Category</th><th>Description</th></tr></thead>
          <tbody><tr><td>Example category</td><td>Context retained from the educational table</td></tr></tbody></table>
        <p>${PROSE[1]}</p><p>${PROSE[2]}</p>
      </div></section>
      ${groups.map((heading, index) => `<section id="cat_${index}_section"><div class="section">
        <div class="section-header"><div class="section-title"><h2>${heading}</h2></div><button>Expand Section</button></div>
        <div class="section-body"><ul class="bulletlist"><li><a href="https://source.example/${index}">${references[index]}</a></li></ul></div>
      </div></section>`).join("")}
    </div>
    <div class="side"><p>Unrelated sidebar promotion.</p></div>
  </article>`)

  assertOrder(text, [alias, "Summary", "Understanding the guide", PROSE[0], "Category", "Description", "Example category", "Context retained from the educational table", PROSE[1], PROSE[2], ...groups.flatMap((heading, index) => [heading, references[index]])])
  assert.doesNotMatch(text, /On this page|Navigation entry only|Expand Section|Unrelated sidebar promotion/)
})
