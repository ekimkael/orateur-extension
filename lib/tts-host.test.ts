import assert from "node:assert/strict"
import test from "node:test"
import { resolveBlockLangs, splitBlocks, splitUnits } from "./tts-host.ts"

const EN_PARAGRAPH =
  "The cat is sitting on the mat and watching the window with attention, " +
  "while the rain falls gently on the roofs of the whole city outside."
const FR_PARAGRAPH =
  "Le chat est assis sur le tapis et regarde la fenêtre avec attention, " +
  "pendant que la pluie tombe doucement sur les toits de la ville entière."

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
    { text: "Un.", endsParagraph: true, paragraph: 0, lang: "fr" },
    { text: "Deux.", endsParagraph: true, paragraph: 1, lang: "fr" },
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

test("resolveBlockLangs : titre court hérite du paragraphe anglais qui le suit", () => {
  assert.deepEqual(resolveBlockLangs(["Overview", EN_PARAGRAPH], "fr"), ["en", "en"])
})

test("resolveBlockLangs : liste d'items courts hérite du paragraphe anglais qui la précède", () => {
  const blocks = [EN_PARAGRAPH, "First item", "Second item"]
  assert.deepEqual(resolveBlockLangs(blocks, "fr"), ["en", "en", "en"])
})

test("resolveBlockLangs : bloc court isolé, hors de portée de tout voisin décidé, retombe sur docLang", () => {
  // "c" est à distance 3 des deux extrémités décidées : hors de NEIGHBOR_RANGE (2).
  const blocks = [FR_PARAGRAPH, "a", "b", "c", "d", "e", EN_PARAGRAPH]
  assert.deepEqual(resolveBlockLangs(blocks, "de"), ["fr", "fr", "fr", "de", "en", "en", "en"])
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

test("splitUnits rapporte chaque unité à son paragraphe", () => {
  const phrase = (n: number) => `Phrase numéro ${n} ${"a".repeat(200)}.`
  const units = splitUnits(`${phrase(1)} ${phrase(2)}\n\nCourt.\n\nAutre.`, "fr")
  assert.deepEqual(
    units.map((u) => u.paragraph),
    [0, 0, 1, 2]
  )
})

test("splitUnits bascule un paragraphe entièrement anglais dans un texte français", () => {
  const fr =
    "Le chat est assis sur le tapis et regarde la fenêtre avec attention, pendant que la " +
    "pluie tombe doucement sur les toits de la ville entière."
  const en =
    "The cat is sitting on the mat and watching the window with attention, while the rain " +
    "falls gently on the roofs of the whole city outside."
  const units = splitUnits(`${fr}\n\n${en}\n\nCourt.`, "fr")
  assert.deepEqual(
    units.map((u) => u.lang),
    ["fr", "en", "fr"]
  )
})
