// Porté de web/app/lib/supertonic/engine.test.ts (vitest) vers node:test —
// aucune dépendance au DOM à ce niveau, `import type * as ort` est effacé par
// le strip de types de Node.
import assert from "node:assert/strict"
import test from "node:test"
import { chunkText, UnicodeProcessor, writeWavFile } from "./engine.ts"

test("chunkText renvoie un seul bloc pour un texte court", () => {
  assert.deepEqual(chunkText("Hello world.", 300), ["Hello world."])
})

test("chunkText ajoute un point si le texte n'en a pas", () => {
  const chunks = chunkText("Hello world", 300)
  assert.equal(chunks[0], "Hello world.")
})

test("chunkText découpe un texte long en plusieurs blocs", () => {
  const long = "First sentence. ".repeat(30)
  const chunks = chunkText(long, 100)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) assert.ok(chunk.length <= 110)
})

test("chunkText découpe un paragraphe japonais sans espaces", () => {
  // Le japonais ne met pas d'espace après 。 : sans coupe sur la ponctuation
  // elle-même, tout le paragraphe repartait en un seul chunk.
  const long = "これはとても長い日本語の文章です。".repeat(20)
  const chunks = chunkText(long, 120)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) assert.ok(chunk.length <= 120, `chunk trop long: ${chunk.length}`)
})

test("chunkText coupe sur les virgules CJK quand une phrase dépasse maxLen", () => {
  const chunks = chunkText(`${"あ".repeat(80)}、${"い".repeat(80)}。`, 120)
  assert.equal(chunks.length, 2)
  for (const chunk of chunks) assert.ok(chunk.length <= 120)
})

test("UnicodeProcessor.preprocessText enveloppe le texte dans des balises de langue", () => {
  const proc = new UnicodeProcessor([])
  assert.equal(proc.preprocessText("Hello.", "en"), "<en>Hello.</en>")
})

test("UnicodeProcessor.preprocessText normalise l'unicode et ajoute un point", () => {
  const proc = new UnicodeProcessor([])
  const result = proc.preprocessText("Hello world", "fr")
  assert.ok(result.includes("<fr>"))
  assert.ok(result.includes("Hello world."))
  assert.ok(result.includes("</fr>"))
})

test("UnicodeProcessor.preprocessText retire les émojis", () => {
  const proc = new UnicodeProcessor([])
  const result = proc.preprocessText("Hello 🎉 world.", "en")
  assert.ok(!result.includes("🎉"))
})

test("UnicodeProcessor.preprocessText lève sur une langue invalide", () => {
  const proc = new UnicodeProcessor([])
  assert.throws(() => proc.preprocessText("text.", "zz"), /Invalid language/)
})

test("writeWavFile produit un buffer avec l'en-tête RIFF", () => {
  const samples = new Array(100).fill(0.5)
  const buffer = writeWavFile(samples, 44100)
  const view = new DataView(buffer)
  const riff = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  )
  assert.equal(riff, "RIFF")
})

test("writeWavFile renvoie un buffer de la taille attendue", () => {
  const samples = new Array(44100).fill(0)
  const buffer = writeWavFile(samples, 44100)
  assert.equal(buffer.byteLength, 44 + 44100 * 2)
})
