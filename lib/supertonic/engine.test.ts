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

// Output is NFKD; compare in NFC so accented expectations stay readable.
const spoken = (text: string, lang: string) => new UnicodeProcessor([]).preprocessText(text, lang).normalize("NFC")

test("UnicodeProcessor garde les milliers groupés comme une quantité et les épelle", () => {
  assert.equal(spoken("40 000 et 1\u202f250\u00a0000", "fr"), "<fr>quarante mille et un million deux cent cinquante mille.</fr>")
  assert.equal(spoken("40,000.50 and -40 000.007", "en"), "<en>forty thousand point five zero and minus forty thousand point zero zero seven.</en>")
  assert.equal(spoken("40 000,007", "fr"), "<fr>quarante mille virgule zéro zéro sept.</fr>")
})

test("UnicodeProcessor épelle les codes à zéro initial chiffre par chiffre", () => {
  assert.equal(spoken("007", "en"), "<en>zero zero seven.</en>")
  assert.equal(spoken("007", "fr"), "<fr>zéro zéro sept.</fr>")
  assert.equal(spoken("1,007 / 0,05", "fr"), "<fr>un virgule zéro zéro sept zéro virgule zéro cinq.</fr>")
  assert.equal(spoken("v1.02.003", "en"), "<en>v one point zero two point zero zero three.</en>")
  assert.equal(spoken("code007", "en"), "<en>code zero zero seven.</en>")
  assert.equal(spoken("𐐀007 et e\u0301007", "en"), "<en>𐐀 zero zero seven et \u00e9 zero zero seven.</en>")
})

test("UnicodeProcessor ne fusionne pas les téléphones à zéro initial", () => {
  assert.equal(spoken("01 000 000", "en"), "<en>zero one zero zero zero zero zero zero.</en>")
  assert.equal(spoken("01 23 45 67 89", "en"), "<en>zero one twenty-three forty-five sixty-seven eighty-nine.</en>")
})

test("UnicodeProcessor lit les heures brutes comme des heures, pas des rapports", () => {
  assert.equal(spoken("14:05 et 14:00", "en"), "<en>two oh five PM et two PM.</en>")
  assert.equal(spoken("14:05 et 10:1", "fr"), "<fr>quatorze heures cinq et dix contre un.</fr>")
})

test("UnicodeProcessor conserve les codes et décimales des autres langues", () => {
  const proc = new UnicodeProcessor([])
  assert.equal(proc.preprocessText("007 et 1,007", "de"), "<de>null null sieben et 1,007.</de>")
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
