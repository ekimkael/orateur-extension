import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { createAnchorFinder } from "./read-anchor.ts"

function docFrom(html: string) {
  return new JSDOM(html).window.document
}

test("retrouve les blocs dans l'ordre du document", () => {
  const doc = docFrom("<article><h2>Un titre</h2><p>Premier paragraphe.</p><p>Second paragraphe.</p></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("Un titre.")?.tagName, "H2")
  assert.equal(find("Premier paragraphe.")?.textContent, "Premier paragraphe.")
  assert.equal(find("Second paragraphe.")?.textContent, "Second paragraphe.")
})

test("deux paragraphes identiques renvoient deux éléments distincts", () => {
  const doc = docFrom("<article><p>Même texte.</p><p>Même texte.</p></article>")
  const find = createAnchorFinder(doc)

  const first = find("Même texte.")
  const second = find("Même texte.")
  assert.ok(first && second)
  assert.notEqual(first, second)
})

test("un bloc introuvable ne désynchronise pas les suivants", () => {
  // Ce que produit l'extracteur d'un <pre> : une annonce, pas le code.
  const doc = docFrom("<article><p>Avant le code.</p><pre>const x = 1</pre><p>Après le code.</p></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("Avant le code.")?.tagName, "P")
  assert.equal(find("Extrait de code."), null)
  assert.equal(find("Après le code.")?.textContent, "Après le code.")
})

test("le point ajouté par withStop ne fait pas manquer le titre", () => {
  const doc = docFrom("<article><h1>Un titre sans ponctuation</h1></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("Un titre sans ponctuation.")?.tagName, "H1")
})

test("correspond même si l'extraction a rogné la fin du bloc", () => {
  // Le bouton de partage vit dans le <p> : l'extracteur l'a retiré du clone,
  // donc le texte lu est plus court que celui de l'élément vivant.
  const doc = docFrom("<article><p>Le corps du paragraphe est ici.<button>Partager</button></p></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("Le corps du paragraphe est ici.")?.tagName, "P")
})

test("les blocs de navigation qui précèdent l'article sont dépassés", () => {
  const doc = docFrom("<nav><ul><li>Accueil</li><li>Contact</li></ul></nav><article><p>Le vrai contenu.</p></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("Le vrai contenu.")?.closest("article")?.tagName, "ARTICLE")
})

test("une citation l'emporte sur le paragraphe qu'elle contient", () => {
  const doc = docFrom("<article><blockquote><p>Une citation célèbre.</p></blockquote><p>La suite.</p></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("Une citation célèbre.")?.tagName, "BLOCKQUOTE")
  assert.equal(find("La suite.")?.tagName, "P")
})

test("un bloc vide ne renvoie rien", () => {
  const doc = docFrom("<article><p>Du texte.</p></article>")
  const find = createAnchorFinder(doc)

  assert.equal(find("   "), null)
})
