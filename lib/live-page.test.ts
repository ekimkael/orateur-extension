import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { createLivePage } from "./live-page.ts"

const FR = "Le chat est assis sur le tapis et regarde la fenêtre avec attention, pendant que la pluie tombe doucement sur les toits de la ville entière."
const EN = "The cat is sitting on the mat and watching the window with attention, while the rain falls gently on the roofs of the whole city outside."

function fixture() {
  const doc = new JSDOM(`<html lang="fr"><body><article><p>${FR}</p><p>${EN}</p></article></body></html>`).window.document
  const paragraphs = [...doc.querySelectorAll("p")]
  return { doc, first: paragraphs[0]!, later: paragraphs[1]!, blocks: [FR, EN] }
}

test("waits for a lazy paragraph translation before handing its text to speech", async () => {
  const { doc, first, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  const said: string[] = []
  let reveals = 0
  first.scrollIntoView = () => assert.fail("Already translated prose needs no preparation scroll")
  later.scrollIntoView = (options) => {
    reveals++
    assert.deepEqual(options, { block: "center", behavior: "instant" })
  }

  assert.equal(await live.prepare(0, true), FR)
  const speech = live.prepare(1, true).then((text) => said.push(text))
  await Promise.resolve()
  assert.equal(reveals, 1)
  assert.deepEqual(said, [], "English snapshot cannot reach speech while translation is pending")
  queueMicrotask(() => { later.firstChild!.textContent = FR })
  await speech
  assert.deepEqual(said, [FR])
  live.stop()
})

test("keeps eager node mappings when translation happens before preparation", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  assert.equal(live.anchors[1], later)
  later.textContent = FR
  later.scrollIntoView = () => assert.fail("Already translated prose needs no preparation scroll")

  assert.equal(await live.prepare(1, true), FR)
  assert.equal(live.anchors[1], later)
  live.stop()
})

test("bounds translation waits and retains extraction cleanup for unchanged English quotes", async () => {
  const { doc, later, blocks } = fixture()
  later.append(doc.createElement("button"))
  later.lastChild!.textContent = "Share this quotation"
  const live = createLivePage(doc, blocks, 10, () => true)
  let reveals = 0
  later.scrollIntoView = () => { reveals++ }

  assert.equal(await live.prepare(1, true), EN)
  assert.equal(reveals, 1)
  live.stop()
})

test("reads changed live prose without scrolling when following is disabled", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  later.scrollIntoView = () => assert.fail("Follow disabled must preserve the viewport")
  assert.equal(await live.prepare(1, false), EN)
  later.textContent = FR

  assert.equal(await live.prepare(1, false), FR)
  live.stop()
})

test("excludes hidden controls and scripts from refreshed translated prose", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  later.replaceChildren(doc.createTextNode(FR.replace(/\.$/, "")))
  for (const [tag, attribute] of [["button", null], ["span", "hidden"], ["span", "aria-hidden"], ["script", null]] as const) {
    const noise = doc.createElement(tag)
    if (attribute) noise.setAttribute(attribute, attribute === "hidden" ? "" : "true")
    noise.textContent = " Unwanted original English interface text."
    later.append(noise)
  }
  later.scrollIntoView = () => assert.fail("Refreshed French prose should already be ready")

  assert.equal(await live.prepare(1, true), FR)
  live.stop()
})

test("stopping cancels pending preparation and prevents subsequent preparation", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  let reveals = 0
  later.scrollIntoView = () => { reveals++ }
  const pending = live.prepare(1, true)
  const cancelled = assert.rejects(pending, /Reading stopped/)
  assert.equal(reveals, 1)

  live.stop()
  await cancelled
  later.textContent = FR
  await assert.rejects(live.prepare(1, true), /Reading stopped/)
  assert.equal(reveals, 1)
})

test("retains extracted text when its source element disappears or has no anchor", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, [...blocks, "Extrait de code."], 5000, () => true)
  later.remove()

  assert.equal(await live.prepare(1, true), EN)
  assert.equal(await live.prepare(2, true), "Extrait de code.")
  live.stop()
})

test("a French interface with an English message does not imply active translation", async () => {
  for (const signal of [undefined, () => false]) {
    const { doc, later, blocks } = fixture()
    const live = createLivePage(doc, blocks, 5000, signal)
    later.scrollIntoView = () => assert.fail("A language mismatch without translation must not scroll")
    let ready = false
    const preparation = live.prepare(1, true).then((text) => { ready = true; return text })
    await Promise.resolve()
    assert.equal(ready, true, "An untranslated message must not wait for a translation timeout")
    assert.equal(await preparation, EN)

    later.textContent = FR
    assert.equal(await live.prepare(1, true), FR, "Live text still refreshes without a translation signal")
    live.stop()
  }
})

test("waits for an ambiguous offscreen heading to change on a translated page", async () => {
  const doc = new JSDOM('<html lang="fr"><body><article><h2>Reflections</h2></article></body></html>').window.document
  const heading = doc.querySelector("h2")!
  heading.getBoundingClientRect = () => new doc.defaultView!.DOMRect(0, 1000, 300, 50)
  let reveals = 0
  heading.scrollIntoView = () => {
    reveals++
    queueMicrotask(() => { heading.textContent = "Réflexions" })
  }
  const live = createLivePage(doc, ["Reflections."], 5000, () => true)

  const preparation = live.prepare(0, true)
  assert.equal(reveals, 1)
  assert.equal(await preparation, "Réflexions.")
  live.stop()
})

test("does not delay an ambiguous heading already visible on a translated page", async () => {
  const doc = new JSDOM('<html lang="fr"><body><h2>Reflections</h2></body></html>').window.document
  const heading = doc.querySelector("h2")!
  heading.getBoundingClientRect = () => new doc.defaultView!.DOMRect(0, 10, 300, 50)
  heading.scrollIntoView = () => assert.fail("Visible ambiguous headings need no preparation scroll")
  const live = createLivePage(doc, ["Reflections."], 5000, () => true)

  assert.equal(await live.prepare(0, true), "Reflections.")
  live.stop()
})
