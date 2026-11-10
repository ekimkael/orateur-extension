import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

test("NPR conserve légende et prose sans doubler le crédit ni lire les commandes et l'avertissement", () => {
  // Structure photo et avertissement constatés sur un article NPR public.
  const caption = "A conservator examines a historical map in the museum workshop."
  const credit = "Alex Martin for NPR"
  const paragraphs = [
    "Inside the museum workshop, conservators examine historical maps before deciding how to restore them. They photograph tears, record the remaining colors and describe the notes that readers added over several generations.",
    "The work begins with careful cleaning and continues with repairs using compatible materials. Every decision is documented so that future teams can distinguish the original paper from later additions and understand why a repair was necessary.",
    "Once the work is complete, the maps return to storage in protective boxes. Visitors will be able to compare the restored documents with photographs taken before treatment, while researchers can consult the detailed records prepared by the team.",
  ]
  const doc = new JSDOM(`<!doctype html><html lang="en"><head>
    <title>How museums protect historical maps : NPR</title></head><body>
    <article class="story"><h1>How museums protect historical maps</h1>
      <div id="storytext">
        <div class="bucketwrap image"><div class="credit-caption">
          <div class="caption-wrap"><div class="caption" aria-label="Image caption">
            <p>${caption}<b class="credit" aria-label="Image credit">${credit}</b>
              <b class="hide-caption"><b>hide caption</b></b></p>
          </div><button class="toggle-caption">toggle caption</button></div>
          <span class="credit" aria-label="Image credit">${credit}</span>
        </div></div>
        ${paragraphs.map(text => `<p>${text}</p>`).join("")}
      </div>
      <div class="anti-fraud-message"><p>This message explains how to report suspicious requests for payment.<br>Contact the newsroom if someone charges you for an interview.</p></div>
    </article></body></html>`, {
    url: "https://www.npr.org/2026/10/18/nx-s1-1234567/historical-maps",
  }).window.document

  const { textContent } = extractArticle(doc)
  assert.ok(textContent.includes(caption))
  assert.equal(textContent.split(credit).length - 1, 1)
  for (const paragraph of paragraphs) assert.ok(textContent.includes(paragraph), paragraph)
  assert.ok(textContent.endsWith(paragraphs.at(-1)!))
  assert.doesNotMatch(textContent, /hide caption|toggle caption|suspicious requests|charges you for an interview/)
})
