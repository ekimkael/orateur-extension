import assert from "node:assert/strict"
import test from "node:test"
import { splitBlocks } from "./tts-host.ts"

test("splitBlocks découpe sur les paragraphes", () => {
  assert.deepEqual(splitBlocks("Un.\n\nDeux.\n\nTrois."), ["Un.", "Deux.", "Trois."])
})

test("splitBlocks ignore les blocs vides et les espaces", () => {
  assert.deepEqual(splitBlocks("\n\n  \n\nTexte\n\n \n\n"), ["Texte"])
})

test("splitBlocks renvoie un tableau vide pour un texte vide", () => {
  assert.deepEqual(splitBlocks(""), [])
})
