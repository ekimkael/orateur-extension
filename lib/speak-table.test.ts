import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { speakTable } from "./speak-table.ts"

function table(html: string) {
  const { document } = new JSDOM(`<table>${html}</table>`).window
  return document.querySelector("table") as HTMLTableElement
}

const row = (cells: string[], tag = "td") => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`
const header = row(["Fruit", "Prix", "Stock"], "th")
const fruits = header + row(["Pomme", "2 €", "12"]) + row(["Poire", "3 €", "4"])

test("reads each row with its column headers", () => {
  assert.deepEqual(speakTable(table(fruits), "fr"), [
    "Pomme : prix, 2 € ; stock, 12.",
    "Poire : prix, 3 € ; stock, 4.",
  ])
})

test("drops the space before colons and semicolons outside French", () => {
  assert.deepEqual(speakTable(table(fruits), "en")?.[0], "Pomme: prix, 2 €; stock, 12.")
})

test("finds the header row in thead", () => {
  const html = `<thead>${row(["Fruit", "Prix"])}</thead><tbody>${row(["Pomme", "2 €"])}</tbody>`
  assert.deepEqual(speakTable(table(html), "fr"), ["Pomme : prix, 2 €."])
})

test("says the caption before the rows", () => {
  assert.deepEqual(speakTable(table(`<caption>Prix des fruits</caption>${fruits}`), "fr")?.[0], "Prix des fruits.")
})

test("skips empty cells and empty rows", () => {
  const html = header + row(["Pomme", " ", "12"]) + row(["", "", ""])
  assert.deepEqual(speakTable(table(html), "fr"), ["Pomme : stock, 12."])
})

test("keeps an all-caps header as written", () => {
  const html = row(["Pays", "PIB"], "th") + row(["France", "3 000"])
  assert.deepEqual(speakTable(table(html), "fr"), ["France : PIB, 3 000."])
})

const NOTICE_FR = ["Vous pouvez consulter le tableau ci-dessous."]

test("announces a table with more than 8 data rows", () => {
  const html = header + row(["Pomme", "2 €", "12"]).repeat(9)
  assert.deepEqual(speakTable(table(html), "fr"), NOTICE_FR)
  assert.deepEqual(speakTable(table(html), "en"), ["You can look at the table below."])
})

test("reads a table with exactly 8 data rows and 4 columns", () => {
  const html = row(["A", "B", "C", "D"], "th") + row(["a", "b", "c", "d"]).repeat(8)
  assert.equal(speakTable(table(html), "fr")?.length, 8)
})

test("announces a table with more than 4 columns", () => {
  const html = row(["A", "B", "C", "D", "E"], "th") + row(["a", "b", "c", "d", "e"])
  assert.deepEqual(speakTable(table(html), "fr"), NOTICE_FR)
})

test("announces merged cells, nested tables and ragged rows", () => {
  const merged = header + `<tr><td>Pomme</td><td colspan="2">épuisé</td></tr>`
  const nested = header + `<tr><td>Pomme</td><td><table><tr><td>x</td></tr></table></td><td>1</td></tr>`
  const ragged = header + row(["Pomme", "2 €"])
  for (const html of [merged, nested, ragged]) assert.deepEqual(speakTable(table(html), "fr"), NOTICE_FR)
})

test("leaves layout tables to the regular reading", () => {
  assert.equal(speakTable(table(row(["Pomme", "2 €"]) + row(["Poire", "3 €"])), "fr"), null)
  assert.equal(speakTable(table(row(["Fruit"], "th") + row(["Pomme"])), "fr"), null)
})
