import assert from "node:assert/strict"
import test from "node:test"
import { downloadPdf, parsePdfSource, pdfSourceUrl, pdfTabSource } from "./pdf-source.ts"
import { PDF_MAX_BYTES, PdfError } from "./pdf-types.ts"

const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic test data")
const code = (expected: string) => (error: unknown) => error instanceof PdfError && error.code === expected

test("accepts document URLs and rejects executable, credentialed, ambiguous or oversized sources", () => {
  assert.equal(pdfSourceUrl("https://example.org/report#page=3"), "https://example.org/report")
  assert.equal(pdfSourceUrl("file:///tmp/document.pdf"), "file:///tmp/document.pdf")
  for (const source of ["javascript:alert(1)", "data:application/pdf,hello", "blob:https://example.org/id", "ftp://example.org/a.pdf", "https://user:secret@example.org/a.pdf", "https://example.org/" + "a".repeat(16_384), undefined]) {
    assert.equal(pdfSourceUrl(source), null)
  }
  assert.equal(parsePdfSource("#url=https%3A%2F%2Fexample.org%2Ffile%3Fid%3D2%26download%3D1"), "https://example.org/file?id=2&download=1")
  assert.equal(parsePdfSource("#url=https://one.test&url=https://two.test"), null)
  assert.equal(parsePdfSource("#url=javascript:alert(1)"), null)
})

test("extracts only known browser PDF viewer wrappers", () => {
  assert.equal(pdfTabSource("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=https%3A%2F%2Fexample.org%2Freport.pdf"), "https://example.org/report.pdf")
  assert.equal(pdfTabSource("resource://pdf.js/web/viewer.html?file=file%3A%2F%2F%2Ftmp%2Fa.pdf"), "file:///tmp/a.pdf")
  assert.equal(pdfTabSource("chrome-extension://untrusted/index.html?file=https://example.org/a.pdf"), null)
  assert.equal(pdfTabSource("chrome://settings"), null)
})

test("downloads suffixless PDFs with progress and no content upload", async (t) => {
  const progress: number[] = []
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://example.org/download?id=3")
    assert.equal(options?.method, undefined, "uses GET")
    assert.equal(options?.body, undefined)
    assert.equal(options?.credentials, "include")
    assert.equal(options?.referrerPolicy, "no-referrer")
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 10))
      controller.enqueue(bytes.slice(10))
      controller.close()
    } }), { headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length) } })
  })
  assert.deepEqual(await downloadPdf("https://example.org/download?id=3", { onProgress: ({ loaded }) => progress.push(loaded) }), bytes)
  assert.deepEqual(progress, [0, 10, bytes.length])
  assert.equal(fetch.mock.callCount(), 1)
})

test("rejects advertised size before downloading the body and cancels it", async (t) => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), {
    headers: { "content-length": String(PDF_MAX_BYTES + 1) },
  }))
  await assert.rejects(downloadPdf("https://example.org/a.pdf"), code("too-large"))
  assert.equal(cancelled, true)
})

test("enforces the byte limit even if the server lies about content-length", async (t) => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(PDF_MAX_BYTES))
      controller.enqueue(new Uint8Array(1))
    },
    cancel() { cancelled = true },
  }), { headers: { "content-length": "1" } }))
  await assert.rejects(downloadPdf("https://example.org/a.pdf"), code("too-large"))
  assert.equal(cancelled, true)
})

test("distinguishes network errors, HTTP failures and invalid PDF responses", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("network error") })
  await assert.rejects(downloadPdf("https://example.org/a.pdf"), code("download"))
  fetch.mock.mockImplementation(async () => new Response("denied", { status: 403 }))
  await assert.rejects(downloadPdf("https://example.org/a.pdf"), code("download"))
  fetch.mock.mockImplementation(async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html; charset=utf-8" } }))
  await assert.rejects(downloadPdf("https://example.org/a.pdf"), code("invalid"))
  fetch.mock.mockImplementation(async () => new Response("not a PDF", { headers: { "content-type": "application/pdf" } }))
  await assert.rejects(downloadPdf("https://example.org/a.pdf"), code("invalid"))
})

test("cancels both pre-aborted and in-flight downloads", async (t) => {
  const controller = new AbortController()
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
  }))
  await assert.rejects(downloadPdf("https://example.org/a.pdf", { signal: AbortSignal.abort() }), { name: "AbortError" })
  assert.equal(fetch.mock.callCount(), 0)
  const pending = downloadPdf("https://example.org/a.pdf", { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: "AbortError" })
})

test("local file requests use abortable XHR and never fetch a remote service", async (t) => {
  let instance: FakeXHR
  class FakeXHR {
    status = 0
    response: ArrayBuffer = bytes.buffer
    onload?: () => void
    onabort?: () => void
    onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void
    constructor() { instance = this }
    open(method: string, url: string) { assert.equal(method, "GET"); assert.equal(url, "file:///tmp/a.pdf") }
    send() {}
    abort() { this.onabort?.() }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest")
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeXHR })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original)
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest")
  })
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("unexpected network") })
  const success = downloadPdf("file:///tmp/a.pdf")
  instance!.onload!()
  assert.deepEqual(await success, bytes)
  const controller = new AbortController()
  const cancelled = downloadPdf("file:///tmp/a.pdf", { signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled, { name: "AbortError" })
  const oversized = downloadPdf("file:///tmp/a.pdf")
  instance!.onprogress!({ loaded: 2, total: PDF_MAX_BYTES + 1, lengthComputable: true })
  await assert.rejects(oversized, code("too-large"))
  assert.equal(fetch.mock.callCount(), 0)
})
