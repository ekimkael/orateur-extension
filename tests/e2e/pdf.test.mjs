import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { browserTest, browserName, waitFor } from "../support/browser.mjs"

const pdf = { pdf: true, skip: process.env.ORATEUR_TEST_PDF !== "1" }
const textSelector = 'article[aria-label="Extracted PDF text"]'

async function upload(page, name) {
  const input = await page.$('input[type="file"]')
  assert.ok(input, "PDF file picker exists")
  const path = fileURLToPath(new URL(`../fixtures/pdf/${name}.pdf`, import.meta.url))
  if (browserName === "firefox") {
    // Firefox BiDi's input.setFiles rejects extension pages. Supply the same
    // fixture bytes through the native File API; PDF.js and the UI stay real.
    await page.evaluate(({ name, bytes }) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], `${name}.pdf`, { type: "application/pdf" }))
      const input = document.querySelector('input[type="file"]')
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }, { name, bytes: [...await readFile(path)] })
  } else {
    await input.uploadFile(path)
  }
  await input.dispose()
}

browserTest("PDF: loads a URL with the packaged PDF.js worker and preserves reading order", async h => {
  await h.install()
  await h.options.evaluate(hash => { location.hash = hash }, new URLSearchParams({ url: `${h.url}/pdf/simple.pdf` }).toString())
  await h.reloadOptions()
  await h.options.waitForSelector(textSelector)

  const extracted = await h.options.evaluate(selector => ({
    title: document.title,
    heading: document.querySelector("h1").textContent,
    language: document.querySelector(selector).lang,
    paragraphs: [...document.querySelectorAll(`${selector} p`)].map(node => node.textContent),
    source: document.querySelector(".pdf-source").textContent,
  }), textSelector)

  assert.equal(extracted.heading, "Un document simple")
  assert.equal(extracted.title, "Un document simple — Orateur PDF")
  assert.equal(extracted.language, "fr")
  assert.deepEqual(extracted.paragraphs, [
    "Une lecture simple",
    "Voici la première ligne du document. La deuxième ligne poursuit le même paragraphe.",
    "Le second paragraphe reste bien distinct.",
  ])
  assert.match(extracted.source, /simple\.pdf.*1 pages/)
}, pdf)

browserTest("PDF: local upload preserves page order and body text across three pages", async h => {
  await h.install()
  await upload(h.options, "multipage")
  await h.options.waitForSelector(textSelector)

  const extracted = await h.options.evaluate(selector => ({
    title: document.querySelector("h1").textContent,
    text: document.querySelector(selector).textContent,
    source: document.querySelector(".pdf-source").textContent,
    alert: document.querySelector('[role="alert"]')?.textContent,
  }), textSelector)

  assert.equal(extracted.title, "Trois pages dans le bon ordre")
  assert.match(extracted.source, /multipage\.pdf.*3 pages/)
  assert.equal(extracted.alert, undefined)
  const ordered = ["Première page", "Deuxième page", "Troisième page"].map(text => extracted.text.indexOf(text))
  assert.ok(ordered[0] >= 0 && ordered[0] < ordered[1] && ordered[1] < ordered[2], "Page order survives PDF extraction")
  assert.equal(extracted.text.match(/Cette phrase du corps doit rester sur chaque page\./g)?.length, 3)
  assert.doesNotMatch(extracted.text, /Bulletin Orateur|Document de démonstration/)
}, pdf)

browserTest("PDF: protected and scanned documents show actionable errors, then a valid upload recovers", async h => {
  await h.install()
  for (const [name, message] of [
    ["protected", /protected.*password or copying restriction/i],
    ["restricted", /protected.*password or copying restriction/i],
    ["image-only", /no text layer.*OCR.*not available/i],
  ]) {
    await upload(h.options, name)
    await waitFor(async () => {
      const state = await h.options.evaluate(() => ({
        alert: document.querySelector('[role="alert"]')?.textContent ?? "",
        source: document.querySelector(".pdf-source")?.textContent,
        loading: Boolean(document.querySelector("progress")),
      }))
      return state.source === `${name}.pdf` && !state.loading && message.test(state.alert)
    }, `${name}.pdf explains why extraction cannot continue`)
    assert.equal(await h.options.$(textSelector), null, "Failed extraction exposes no stale document")
  }

  await upload(h.options, "simple")
  await h.options.waitForSelector(textSelector)
  assert.equal(await h.options.$eval("h1", node => node.textContent), "Un document simple")
  assert.equal(await h.options.$('[role="alert"]'), null, "Successful upload clears the previous error")
}, pdf)
