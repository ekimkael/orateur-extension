import {
  PDF_MAX_BYTES, PDF_MAX_PAGES, PDF_MAX_TEXT_CHARS, PDF_MAX_TEXT_ITEMS, PdfError,
} from "./pdf-types.ts"
import { pdfPagesText, pdfTextLines, type PdfTextItem, type PdfTextPage } from "./pdf-text.ts"

export { PDF_MAX_BYTES, PdfError } from "./pdf-types.ts"
export type { PdfErrorCode } from "./pdf-types.ts"

export type PdfExtractionOptions = {
  signal?: AbortSignal
  onProgress?: (progress: { phase: "extracting"; completed: number; total: number }) => void
  workerSrc?: string
  assetsUrl?: string
}

export type ExtractedPdf = { text: string; pageCount: number; title?: string; lang?: string }

/** All PDF content is processed locally; only packaged font/CMap assets are read. */
export async function extractPdf(data: Uint8Array, options: PdfExtractionOptions = {}): Promise<ExtractedPdf> {
  const { signal, onProgress } = options
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Extraction annulée.", "AbortError")
  }
  checkAbort()
  if (data.byteLength > PDF_MAX_BYTES) throw new PdfError("too-large")
  if (!data.byteLength) throw new PdfError("invalid")

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  checkAbort()
  if (options.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc
  const assets = options.assetsUrl?.replace(/\/?$/, "/")
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    // PDF.js 6 removed dynamic evaluation; no scripting or XFA renderer is loaded.
    enableXfa: false,
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    cMapUrl: assets ? `${assets}cmaps/` : undefined,
    cMapPacked: true,
    standardFontDataUrl: assets ? `${assets}standard_fonts/` : undefined,
  })
  let destroyPromise: Promise<void> | undefined
  const destroy = () => destroyPromise ??= task.destroy()
  let abort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new DOMException("Extraction annulée.", "AbortError"))
      void destroy().catch(() => {})
    }
    signal?.addEventListener("abort", abort, { once: true })
  })

  const read = async (): Promise<ExtractedPdf> => {
    const document = await task.promise
    checkAbort()
    if (document.numPages > PDF_MAX_PAGES) throw new PdfError("too-large")
    const permissions = await document.getPermissions()
    if (permissions && !permissions.has(pdfjs.PermissionFlag.COPY)
      && !permissions.has(pdfjs.PermissionFlag.COPY_FOR_ACCESSIBILITY)) throw new PdfError("protected")

    const pages: PdfTextPage[] = []
    let characterCount = 0
    let itemCount = 0
    onProgress?.({ phase: "extracting", completed: 0, total: document.numPages })
    for (let index = 1; index <= document.numPages; index++) {
      checkAbort()
      const page = await document.getPage(index)
      const reader = page.streamTextContent({ includeMarkedContent: false }).getReader()
      const items: PdfTextItem[] = []
      try {
        while (true) {
          checkAbort()
          const { done, value } = await reader.read()
          if (done) break
          for (const item of value.items) {
            if (!("str" in item)) continue
            characterCount += item.str.length
            itemCount++
            if (characterCount > PDF_MAX_TEXT_CHARS || itemCount > PDF_MAX_TEXT_ITEMS) throw new PdfError("too-large")
            items.push(item)
          }
        }
      } finally {
        reader.releaseLock()
        page.cleanup()
      }
      pages.push(pdfTextLines(items, page.getViewport({ scale: 1 })))
      onProgress?.({ phase: "extracting", completed: index, total: document.numPages })
    }
    checkAbort()
    const text = pdfPagesText(pages)
    if (!text) throw new PdfError("no-text")
    const metadata = await document.getMetadata().catch(() => null)
    checkAbort()
    const info = metadata?.info as { Title?: unknown; Language?: unknown } | undefined
    const title = typeof info?.Title === "string" ? info.Title.trim().slice(0, 500) || undefined : undefined
    const lang = typeof info?.Language === "string" && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(info.Language)
      ? info.Language : undefined
    return { text, pageCount: document.numPages, title, lang }
  }

  try {
    return await Promise.race([read(), aborted])
  } catch (error) {
    checkAbort()
    if (error instanceof PdfError) throw error
    if (error instanceof Error && error.name === "PasswordException") throw new PdfError("protected")
    throw new PdfError("invalid")
  } finally {
    if (abort) signal?.removeEventListener("abort", abort)
    await destroy().catch(() => {})
  }
}
