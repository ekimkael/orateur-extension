import { withStop } from "./reading-intro.ts"

/** Past these sizes a row-by-row reading takes longer than looking at the table (about 30 s). */
const MAX_DATA_ROWS = 8
const MAX_COLUMNS = 4

/** Said instead of a data table too large or irregular to read; French is the fallback. */
const TABLE_NOTICE = "Vous pouvez consulter le tableau ci-dessous."
const TABLE_NOTICE_BY_LANGUAGE: Record<string, string> = {
  en: "You can look at the table below.",
  es: "Puede consultar la tabla de abajo.",
  de: "Sie können die Tabelle unten ansehen.",
  it: "Può consultare la tabella qui sotto.",
  pt: "Pode consultar a tabela abaixo.",
}

const normalize = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()

/** "Prix" → "prix", but "PIB" or "A" stays: a lowered acronym would be misread. */
const asSpokenHeader = (text: string) => (/^\p{Lu}\p{Ll}/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text)

/**
 * Turns a data table into sentences: one per row, each value spoken after its
 * column header ("Pomme : prix, 2 € ; stock, 12."), or a single notice when the
 * table is too large or irregular to pair values with headers safely.
 *
 * Returns `null` for a table without a header row: layout tables (Gmail
 * newsletters, old sites) carry the article itself and must keep the regular
 * cell-by-cell reading. A single column is treated the same way.
 *
 * A ragged row, a merged cell or a nested table gets the notice: guessing
 * which header a value belongs to could attach it to the wrong column.
 */
export function speakTable(table: HTMLTableElement, lang: string): string[] | null {
  const header = table.tHead?.rows[0] ?? table.rows[0]
  if (!header || (!table.tHead && !header.querySelector("th"))) return null
  const headers = Array.from(header.cells, (cell) => asSpokenHeader(normalize(cell.textContent)))
  if (headers.length < 2) return null

  const language = lang.slice(0, 2)
  const notice = [TABLE_NOTICE_BY_LANGUAGE[language] ?? TABLE_NOTICE]
  const rows = Array.from(table.rows).filter((row) => row !== header)
  const irregular =
    rows.length > MAX_DATA_ROWS ||
    headers.length > MAX_COLUMNS ||
    table.querySelector("table") !== null ||
    [header, ...rows].some(
      (row) => row.cells.length !== headers.length || Array.from(row.cells).some((c) => c.rowSpan > 1 || c.colSpan > 1)
    )
  if (irregular) return notice

  // French typography puts a space before ":" and ";"; the other languages do not.
  const space = language === "fr" || !TABLE_NOTICE_BY_LANGUAGE[language] ? " " : ""
  const sentences = rows.flatMap((row) => {
    const [label, ...values] = Array.from(row.cells, (cell) => normalize(cell.textContent))
    const pairs = values.flatMap((value, i) => (value ? [`${headers[i + 1]}, ${value}`] : []))
    const body = pairs.join(`${space}; `)
    const sentence = label && body ? `${label}${space}: ${body}` : label || body
    return sentence ? [withStop(sentence)] : []
  })
  const caption = normalize(table.caption?.textContent ?? null)
  return caption ? [withStop(caption), ...sentences] : sentences
}
