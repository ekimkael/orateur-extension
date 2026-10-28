export type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL: boolean
}

export type PdfLine = { text: string; x: number; y: number; size: number }
export type PdfTextPage = { width: number; height: number; lines: PdfLine[] }

/** PDF coordinates become top-left coordinates, including the page rotation. */
export function pdfTextLines(items: PdfTextItem[], viewport: {
  width: number; height: number; transform: number[]
}): PdfTextPage {
  const [a, b, c, d, e, f] = viewport.transform
  const positioned = items.filter((item) => item.str.trim()).map((item) => {
    const [, , , , tx, ty] = item.transform
    return {
      text: item.str.replace(/\s+/g, " "),
      x: a! * tx! + c! * ty! + e!,
      y: b! * tx! + d! * ty! + f!,
      width: item.width,
      size: Math.max(1, Math.hypot(item.transform[2]!, item.transform[3]!)),
    }
  }).filter((item) => [item.x, item.y, item.width, item.size].every(Number.isFinite))
  positioned.sort((left, right) => left.y - right.y || left.x - right.x)

  const rows: (typeof positioned)[] = []
  for (const item of positioned) {
    const row = rows.at(-1)
    if (row && Math.abs(item.y - row[0]!.y) <= Math.max(2, Math.min(item.size, row[0]!.size) * .3)) {
      row.push(item)
    } else {
      rows.push([item])
    }
  }
  const lines = rows.map((row) => {
    row.sort((left, right) => left.x - right.x)
    let text = ""
    let right = row[0]!.x
    for (const item of row) {
      if (text && !/\s$/.test(text) && !/^\s/.test(item.text) && item.x - right > item.size * .15) text += " "
      text += item.text
      right = item.x + item.width
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: row[0]!.x,
      y: row[0]!.y,
      size: row.reduce((size, item) => Math.max(size, item.size), 1),
    }
  })
  return { width: viewport.width, height: viewport.height, lines }
}

function edge(line: PdfLine, page: PdfTextPage): "top" | "bottom" | undefined {
  if (line.y <= page.height * .08) return "top"
  if (line.y >= page.height * .92) return "bottom"
}

/** Only exact, consistently positioned repetitions outside the body qualify. */
function repeatedMargins(pages: PdfTextPage[]): Set<PdfLine> {
  const removed = new Set<PdfLine>()
  if (pages.length < 3) return removed
  const body = new Set<string>()
  const candidates = new Map<string, { line: PdfLine; page: PdfTextPage; index: number }[]>()
  pages.forEach((page, index) => {
    for (const line of page.lines) {
      const margin = edge(line, page)
      const key = line.text.normalize("NFKC").replace(/\s+/g, " ")
      if (!margin) body.add(key)
      else if (key.length <= 160) {
        const id = `${margin}:${key}`
        const matches = candidates.get(id) ?? []
        matches.push({ line, page, index })
        candidates.set(id, matches)
      }
    }
  })
  for (const [id, matches] of candidates) {
    if (body.has(id.slice(id.indexOf(":") + 1))) continue
    const count = new Set(matches.map((match) => match.index)).size
    if (count < Math.max(3, Math.ceil(pages.length * .75)) || count !== matches.length) continue
    const xs = matches.map(({ line, page }) => line.x / page.width)
    const ys = matches.map(({ line, page }) => line.y / page.height)
    if (Math.max(...xs) - Math.min(...xs) > .02 || Math.max(...ys) - Math.min(...ys) > .005) continue
    for (const { line } of matches) removed.add(line)
  }
  return removed
}

export function pdfPagesText(pages: PdfTextPage[]): string {
  const removed = repeatedMargins(pages)
  return pages.map((page) => {
    const paragraphs: string[] = []
    let previous: PdfLine | undefined
    for (const line of page.lines) {
      if (removed.has(line)) continue
      const gap = previous ? line.y - previous.y : Infinity
      const newParagraph = !previous || gap > Math.max(previous.size, line.size) * 1.5
        || Math.abs(line.size - previous.size) > Math.min(line.size, previous.size) * .2
      if (newParagraph) paragraphs.push(line.text)
      else paragraphs[paragraphs.length - 1] += ` ${line.text}`
      previous = line
    }
    return paragraphs.join("\n\n")
  }).filter(Boolean).join("\n\n").trim()
}
