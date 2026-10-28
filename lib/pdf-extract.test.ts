import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { extractPdf, PDF_MAX_BYTES, PdfError } from "./pdf-extract.ts"

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`../tests/fixtures/pdf/${name}.pdf`, import.meta.url)))
const assetsUrl = new URL("../node_modules/pdfjs-dist/", import.meta.url).pathname
const code = (expected: string) => (error: unknown) => error instanceof PdfError && error.code === expected

test("extracts a real single-column PDF in geometric reading order with paragraphs", async () => {
  const input = await fixture("simple")
  const result = await extractPdf(input, { assetsUrl })
  assert.equal(result.text, "Une lecture simple\n\nVoici la première ligne du document. La deuxième ligne poursuit le même paragraphe.\n\nLe second paragraphe reste bien distinct.")
  assert.equal(result.pageCount, 1)
  assert.equal(result.title, "Un document simple")
  assert.equal(result.lang, "fr")
  assert.ok(input.byteLength > 0, "does not detach caller data")
})

test("preserves page order and body repetitions while removing unambiguous margins", async () => {
  const progress: number[] = []
  const result = await extractPdf(await fixture("multipage"), {
    assetsUrl,
    onProgress: ({ completed, total, phase }) => {
      assert.equal(phase, "extracting")
      assert.equal(total, 3)
      progress.push(completed)
    },
  })
  assert.equal(result.pageCount, 3)
  assert.deepEqual(progress, [0, 1, 2, 3])
  assert.doesNotMatch(result.text, /Bulletin Orateur|Document de démonstration/)
  assert.equal(result.text.match(/Cette phrase du corps/g)?.length, 3)
  assert.ok(result.text.indexOf("Première page") < result.text.indexOf("Deuxième page"))
  assert.ok(result.text.indexOf("Deuxième page") < result.text.indexOf("Troisième page"))
})

test("reports encrypted PDFs without opening a password prompt", async () => {
  await assert.rejects(extractPdf(await fixture("protected"), { assetsUrl }), code("protected"))
})

test("reports image-only PDFs as lacking a text layer", async () => {
  await assert.rejects(extractPdf(await fixture("image-only"), { assetsUrl }), code("no-text"))
})

test("honors copy restrictions even without an opening password", async () => {
  await assert.rejects(extractPdf(await fixture("restricted"), { assetsUrl }), code("protected"))
})

test("rejects empty, corrupt and oversized files with distinct errors", async () => {
  await assert.rejects(extractPdf(new Uint8Array()), code("invalid"))
  await assert.rejects(extractPdf(new TextEncoder().encode("not a pdf")), code("invalid"))
  await assert.rejects(extractPdf(new Uint8Array(PDF_MAX_BYTES + 1)), code("too-large"))
})

test("honors cancellation before opening the document", async () => {
  await assert.rejects(extractPdf(await fixture("simple"), { signal: AbortSignal.abort() }), { name: "AbortError" })
})

test("cancels between pages, destroys the task and supports a fresh extraction", async () => {
  const controller = new AbortController()
  const progress: number[] = []
  await assert.rejects(extractPdf(await fixture("multipage"), {
    assetsUrl,
    signal: controller.signal,
    onProgress: ({ completed }) => {
      progress.push(completed)
      if (completed === 1) controller.abort()
    },
  }), { name: "AbortError" })
  assert.deepEqual(progress, [0, 1])
  assert.equal((await extractPdf(await fixture("simple"), { assetsUrl })).pageCount, 1)
})
