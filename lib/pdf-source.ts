import { PDF_MAX_BYTES, PdfError } from "./pdf-types.ts"

export interface PdfDownloadOptions {
  signal?: AbortSignal
  onProgress?: (progress: { phase: "downloading"; loaded: number; total?: number }) => void
}

/** Only documents selected by the user may be loaded, never executable URLs. */
export function pdfSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null
  try {
    const url = new URL(value)
    if (!["http:", "https:", "file:"].includes(url.protocol) || url.username || url.password) return null
    url.hash = ""
    return url.href
  } catch {
    return null
  }
}

export function parsePdfSource(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""))
  return params.getAll("url").length === 1 ? pdfSourceUrl(params.get("url")) : null
}

export function pdfTabSource(value?: string): string | null {
  const direct = pdfSourceUrl(value)
  if (direct || !value) return direct
  try {
    const url = new URL(value)
    const chromeViewer = url.protocol === "chrome-extension:" && url.hostname === "mhjfbmdgcfjbbpaeojofohoefgiehjai"
    const firefoxViewer = url.protocol === "resource:" && url.hostname === "pdf.js"
    return chromeViewer || firefoxViewer ? pdfSourceUrl(url.searchParams.get("file")) : null
  } catch {
    return null
  }
}

export async function isFileAccessAllowed(): Promise<boolean> {
  // Firefox has no per-extension file-access toggle; the browser still checks the request.
  const check = browser.extension?.isAllowedFileSchemeAccess
  return check ? check().catch(() => false) : true
}

function checkHeader(bytes: Uint8Array): Uint8Array {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024))
  if (!header.includes("%PDF-")) throw new PdfError("invalid")
  return bytes
}

const cancelled = () => new DOMException("Download cancelled", "AbortError")

/** Local files use XHR: Chromium extensions do not support file: in fetch(). */
function downloadFile(url: string, { signal, onProgress }: PdfDownloadOptions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => signal?.removeEventListener("abort", abort)
    xhr.open("GET", url)
    xhr.responseType = "arraybuffer"
    xhr.timeout = 60_000
    xhr.onprogress = (event) => {
      if (event.loaded > PDF_MAX_BYTES || (event.lengthComputable && event.total > PDF_MAX_BYTES)) {
        cleanup()
        reject(new PdfError("too-large"))
        xhr.abort()
        return
      }
      onProgress?.({ phase: "downloading", loaded: event.loaded, total: event.lengthComputable ? event.total : undefined })
    }
    xhr.onload = () => {
      cleanup()
      if ((xhr.status !== 0 && xhr.status !== 200) || !(xhr.response instanceof ArrayBuffer)) return reject(new PdfError("file-access"))
      if (xhr.response.byteLength > PDF_MAX_BYTES) return reject(new PdfError("too-large"))
      try { resolve(checkHeader(new Uint8Array(xhr.response))) }
      catch (error) { reject(error) }
    }
    xhr.onerror = () => { cleanup(); reject(new PdfError("file-access")) }
    xhr.ontimeout = () => { cleanup(); reject(new PdfError("download")) }
    xhr.onabort = () => { cleanup(); reject(cancelled()) }
    signal?.addEventListener("abort", abort, { once: true })
    try { xhr.send() }
    catch { cleanup(); reject(new PdfError("file-access")) }
  })
}

export async function downloadPdf(value: string, options: PdfDownloadOptions = {}): Promise<Uint8Array> {
  const url = pdfSourceUrl(value)
  if (!url) throw new PdfError("invalid")
  if (options.signal?.aborted) throw cancelled()
  if (url.startsWith("file:")) return downloadFile(url, options)

  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener("abort", abort, { once: true })
  const timeout = setTimeout(abort, 60_000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, {
      signal: controller.signal, credentials: "include", cache: "no-store", referrerPolicy: "no-referrer",
    })
    if (!response.ok || !response.body) throw new PdfError("download")
    reader = response.body.getReader()
    if (response.url && !pdfSourceUrl(response.url)) throw new PdfError("invalid")
    if (/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new PdfError("invalid")
    const size = Number(response.headers.get("content-length"))
    const total = Number.isSafeInteger(size) && size > 0 ? size : undefined
    if (total && total > PDF_MAX_BYTES) throw new PdfError("too-large")
    const chunks: Uint8Array[] = []
    let loaded = 0
    options.onProgress?.({ phase: "downloading", loaded, total })
    while (true) {
      if (controller.signal.aborted) throw cancelled()
      const { done, value: chunk } = await reader.read()
      if (done) break
      loaded += chunk.byteLength
      if (loaded > PDF_MAX_BYTES) throw new PdfError("too-large")
      chunks.push(chunk)
      options.onProgress?.({ phase: "downloading", loaded, total })
    }
    if (controller.signal.aborted) throw cancelled()
    const bytes = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return checkHeader(bytes)
  } catch (error) {
    if (options.signal?.aborted) throw cancelled()
    if (error instanceof PdfError) throw error
    throw new PdfError("download")
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abort)
    controller.abort()
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}
