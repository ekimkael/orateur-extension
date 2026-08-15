import assert from "node:assert/strict"
import test from "node:test"
import { splitBlocks, splitUnits } from "./tts-host.ts"

test("splitBlocks découpe sur les paragraphes", () => {
  assert.deepEqual(splitBlocks("Un.\n\nDeux.\n\nTrois."), ["Un.", "Deux.", "Trois."])
})

test("splitBlocks ignore les blocs vides et les espaces", () => {
  assert.deepEqual(splitBlocks("\n\n  \n\nTexte\n\n \n\n"), ["Texte"])
})

test("splitBlocks renvoie un tableau vide pour un texte vide", () => {
  assert.deepEqual(splitBlocks(""), [])
})

test("splitUnits garde un paragraphe court en une seule unité", () => {
  assert.deepEqual(splitUnits("Un.\n\nDeux.", "fr"), [
    { text: "Un.", endsParagraph: true },
    { text: "Deux.", endsParagraph: true },
  ])
})

test("splitUnits découpe un paragraphe long en plusieurs unités", () => {
  // Trois phrases de ~200 caractères : impossible d'en tenir deux sous les 300
  // caractères d'une unité française.
  const phrase = (n: number) => `Phrase numéro ${n} ${"a".repeat(200)}.`
  const units = splitUnits([phrase(1), phrase(2), phrase(3)].join(" "), "fr")
  assert.equal(units.length, 3)
  for (const u of units) assert.ok(u.text.length <= 300, `unité trop longue : ${u.text.length}`)
})

test("splitUnits ne marque la fin de paragraphe que sur la dernière unité", () => {
  const phrase = (n: number) => `Phrase numéro ${n} ${"a".repeat(200)}.`
  const units = splitUnits(`${phrase(1)} ${phrase(2)}\n\nCourt.`, "fr")
  assert.deepEqual(
    units.map((u) => u.endsParagraph),
    [false, true, true]
  )
})

test("splitUnits découpe plus court en japonais et en coréen", () => {
  // Deux phrases de 106 caractères : elles tiennent ensemble sous les 300 du
  // français, pas sous les 120 du japonais.
  const text = `${"a".repeat(105)}. ${"b".repeat(105)}.`
  assert.equal(splitUnits(text, "fr").length, 1)
  assert.equal(splitUnits(text, "ja").length, 2)

  // Vrai japonais : 。 sans espace derrière, qui ne coupait rien avant.
  const ja = "これはとても長い日本語の文章です。".repeat(20)
  const units = splitUnits(ja, "ja")
  assert.ok(units.length > 1)
  for (const unit of units) assert.ok(unit.text.length <= 120)
})

test("splitUnits couvre toutes les unités de tous les paragraphes", () => {
  const units = splitUnits("Un. Deux.\n\nTrois.\n\n  \n\nQuatre.", "fr")
  assert.equal(units.filter((u) => u.endsParagraph).length, 3)
})
