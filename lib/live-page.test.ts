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

test("explicitly untranslated quotes retain extraction cleanup without waiting", async () => {
  const { doc, later, blocks } = fixture()
  later.setAttribute("translate", "no")
  later.append(doc.createElement("button"))
  later.lastChild!.textContent = "Share this quotation"
  const live = createLivePage(doc, blocks, 10, () => true)
  let reveals = 0
  later.scrollIntoView = () => { reveals++ }

  assert.equal(await live.prepare(1, true), EN)
  assert.equal(reveals, 0)
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

test("silently prepares one paragraph ahead while the current paragraph can play", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 10, () => true)
  later.scrollIntoView = () => assert.fail("Passive lookahead must not move the viewport")
  const said = [await live.prepare(0, true)]
  const future = live.prepare(1, true, true)
  let ready = false
  future.then((text) => { ready = true; said.push(text) })
  await Promise.resolve()
  assert.deepEqual(said, [FR])
  assert.equal(ready, false)

  later.textContent = EN.replace("The cat", "The dog")
  await Promise.resolve()
  assert.equal(ready, false, "Another English mutation does not make translated audio ready")
  later.textContent = FR
  assert.equal(await future, FR)
  assert.deepEqual(said, [FR, FR])
  live.stop()
})

test("active playback upgrades the same passive task with nearest alignment", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  const reveals: unknown[] = []
  later.scrollIntoView = (options) => { reveals.push(options) }
  const future = live.prepare(1, true, true)
  assert.equal(live.prepare(1, true, true), future, "Concurrent lookahead shares its observer and promise")
  assert.deepEqual(reveals, [])

  assert.equal(live.prepare(1, true, false, "nearest"), future)
  assert.deepEqual(reveals, [{ block: "nearest", behavior: "instant" }])
  later.textContent = FR
  assert.equal(await future, FR)
  live.stop()
})

test("passive preparation never expires into an unchanged English snapshot", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5, () => true)
  later.scrollIntoView = () => assert.fail("Passive lookahead must not scroll")
  const future = live.prepare(1, true, true)
  let ready = false
  const cancelled = assert.rejects(future, /Reading stopped/)
  future.then(() => { ready = true }, () => {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(ready, false, "The active timeout does not apply to passive lookahead")

  live.stop()
  await cancelled
})

test("a confident language mismatch times out with an error instead of stale English", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5, () => true)
  later.scrollIntoView = () => {}
  await assert.rejects(live.prepare(1, true), /traduction/)

  later.textContent = FR
  assert.equal(await live.prepare(1, true), FR, "Failed preparation releases its pending task")
  live.stop()
})

test("active upgrade releases passive preparation when translation is reverted", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => doc.documentElement.lang !== "en")
  later.scrollIntoView = () => assert.fail("Reverted translation must not reveal a stale target")
  const future = live.prepare(1, true, true)
  doc.documentElement.lang = "en"

  assert.equal(live.prepare(1, true), future)
  assert.equal(await future, EN)
  live.stop()
})

test("notranslate ancestors bypass translation waits", async () => {
  const { doc, later, blocks } = fixture()
  doc.querySelector("article")!.classList.add("notranslate")
  later.scrollIntoView = () => assert.fail("An explicitly untranslated ancestor must not scroll")
  const live = createLivePage(doc, blocks, 5, () => true)

  assert.equal(await live.prepare(1, true, true), EN)
  assert.equal(await live.prepare(1, true), EN)
  live.stop()
})

test("ambiguous proper names may retain their original text after an active bounded wait", async () => {
  const doc = new JSDOM('<html lang="fr"><body><h2>Team Anywhere</h2></body></html>').window.document
  const heading = doc.querySelector("h2")!
  heading.getBoundingClientRect = () => new doc.defaultView!.DOMRect(0, 1000, 300, 50)
  heading.scrollIntoView = () => {}
  const live = createLivePage(doc, ["Team Anywhere."], 5, () => true)
  const future = live.prepare(0, true, true)

  assert.equal(live.prepare(0, true, false, "nearest"), future)
  assert.equal(await future, "Team Anywhere.")
  live.stop()
})

test("stopping rejects every passive preparation without moving the page", async () => {
  const { doc, later, blocks } = fixture()
  const third = later.cloneNode(true) as Element
  later.after(third)
  later.scrollIntoView = () => assert.fail("Stopping passive lookahead must not scroll")
  third.scrollIntoView = () => assert.fail("Stopping passive lookahead must not scroll")
  const live = createLivePage(doc, [...blocks, EN], 5, () => true)
  const first = assert.rejects(live.prepare(1, true, true), /Reading stopped/)
  const second = assert.rejects(live.prepare(2, true, true), /Reading stopped/)

  live.stop()
  await Promise.all([first, second])
})


test("waits for successive translation mutations to settle before returning live text", async () => {
  const { doc, later, blocks } = fixture()
  const live = createLivePage(doc, blocks, 5000, () => true)
  const future = live.prepare(1, true, true)
  later.textContent = FR
  await Promise.resolve()
  const complete = `${FR} Un deuxième passage complète la traduction.`
  later.textContent = complete

  assert.equal(await future, complete)
  live.stop()
})
