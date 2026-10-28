import assert from "node:assert/strict"
import test from "node:test"
import { pdfPagesText, pdfTextLines, type PdfTextPage } from "./pdf-text.ts"

const page = (top = "En-tête", body = "Contenu conservé.", bottom = "Pied de page"): PdfTextPage => ({
  width: 600, height: 800,
  lines: [
    { text: top, x: 60, y: 30, size: 10 },
    { text: body, x: 60, y: 100, size: 12 },
    { text: bottom, x: 60, y: 775, size: 10 },
  ],
})

test("sorts fragments and supplies only the missing spaces", () => {
  const item = (str: string, x: number, y: number, width: number) => ({
    str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL: false,
  })
  const result = pdfTextLines([
    item("monde", 120, 700, 40), item(".", 160, 700, 3), item("Bonjour", 60, 700, 48),
    item("La suite.", 60, 686, 70),
  ], { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] })
  assert.equal(pdfPagesText([result]), "Bonjour monde. La suite.")
})

test("keeps margins on short or inconsistent documents", () => {
  assert.match(pdfPagesText([page(), page()]), /En-tête/)
  assert.match(pdfPagesText([page(), page(), page("Différent"), page("Encore différent")]), /En-tête/)
  const moved = page()
  moved.lines[0]!.x = 180
  assert.match(pdfPagesText([page(), page(), moved]), /En-tête/)
})

test("never strips a repeated margin phrase that also occurs in the body", () => {
  assert.equal(pdfPagesText([page(), page(), page("En-tête", "En-tête")]).match(/En-tête/g)?.length, 4)
})

test("requires exact text repetitions without normalizing numbers or casing", () => {
  const result = pdfPagesText([page("Titre", "Un.", "Page 1"), page("titre", "Deux.", "Page 2"), page("TITRE", "Trois.", "Page 3")])
  assert.match(result, /Page 1/)
  assert.match(result, /Page 2/)
  assert.match(result, /Page 3/)
  assert.match(result, /TITRE/)
})
