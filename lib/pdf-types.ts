export const PDF_MAX_BYTES = 50 * 1024 * 1024
export const PDF_MAX_PAGES = 2_000
export const PDF_MAX_TEXT_CHARS = 5_000_000
export const PDF_MAX_TEXT_ITEMS = 500_000

export type PdfErrorCode = "protected" | "no-text" | "download" | "too-large" | "invalid" | "file-access"

export class PdfError extends Error {
  readonly code: PdfErrorCode

  constructor(code: PdfErrorCode) {
    super(code)
    this.name = "PdfError"
    this.code = code
  }
}
