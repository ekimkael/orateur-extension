import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { extractArticle } from "./extract-article.ts"

test("le corpus complet conserve ses liens documentaires après import sans liens actifs dangereux", () => {
  const prose = "Cette page explique comment lire une documentation et retrouver ses références. Les informations sont organisées en plusieurs sections, avec des listes de ressources et des coordonnées que les lecteurs peuvent consulter pour obtenir davantage de détails."
  const doc = new JSDOM(`<html lang="fr"><head><title>Consulter les ressources documentaires</title></head><body>
    <main id="maincontent"><article><p>${prose}</p><p>${prose}</p><ul>
      <li><a href="/medicines/example/">Référence relative</a></li>
      <li><a href="https://reference.example/document">Référence externe</a></li>
      <li><a href="tel:111">Téléphone</a></li>
      <li><a href="javascript:alert(1)">Texte conservé</a></li>
    </ul></article></main>
  </body></html>`, { url: "https://www.nhs.uk/conditions/example/" }).window.document
  const before = doc.documentElement.outerHTML

  const article = extractArticle(doc)
  const content = new JSDOM(article.content).window.document
  const links = content.querySelectorAll("a")
  assert.equal(links[0]!.getAttribute("href"), "https://www.nhs.uk/medicines/example/")
  assert.equal(links[1]!.getAttribute("href"), "https://reference.example/document")
  assert.equal(links[2]!.getAttribute("href"), "tel:111")
  assert.equal(links[3]!.hasAttribute("href"), false)
  assert.ok(article.textContent.includes("Texte conservé"))
  assert.equal(doc.documentElement.outerHTML, before)
})
