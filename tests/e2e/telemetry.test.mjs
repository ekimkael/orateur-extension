import assert from "node:assert/strict"
import { browserTest, waitFor } from "../support/browser.mjs"

const reader = "orateur-reader-pill"

/** Observe les messages réels du lecteur, sans activer d'envoi vers PostHog. */
async function prepare(h) {
  await h.install()
  await h.options.evaluate(() => {
    globalThis.__readingEvents = []
    ;(globalThis.browser ?? chrome).runtime.onMessage.addListener(message => {
      if (message?.type === "orateur:telemetry:track") globalThis.__readingEvents.push(message.event)
    })
  })
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.script(() => {
    // Ce scénario recommence au début ; le dialogue natif de reprise est hors sujet.
    globalThis.confirm = () => false
    globalThis.__utterances = []
    speechSynthesis.speak = utterance => globalThis.__utterances.push(utterance)
    speechSynthesis.cancel = () => {}
    speechSynthesis.pause = () => {}
    speechSynthesis.resume = () => {}
  })
  await h.click("Read this page with Orateur")
  await countUtterances(h, 1)
}

const events = h => h.options.evaluate(() => globalThis.__readingEvents.filter(event => event.name.startsWith("read_")))
const countUtterances = (h, count) => waitFor(() => h.script(count => globalThis.__utterances.length === count, [count]), `${count} utterances queued`)
const emit = (h, index, type) => h.script((index, type) => globalThis.__utterances[index].dispatchEvent(new Event(type)), [index, type])

browserTest("defaults statistics on and preserves an explicit opt-out across reloads", async h => {
  await h.install({ telemetry: true })
  const toggle = '#confidentialite input[type="checkbox"]'
  const consent = () => h.options.evaluate(async () => (await (globalThis.browser ?? chrome).storage.local.get("orateur:telemetry"))["orateur:telemetry"])
  await h.options.click('a[href="#confidentialite"]')
  await waitFor(() => h.options.$eval(toggle, input => input.checked), "Statistics enabled by default")
  const initial = await consent()
  assert.equal(initial.enabled, true)
  assert.match(initial.distinctId, /^[0-9a-f-]{36}$/)
  await h.reloadOptions()
  await waitFor(() => h.options.$eval(toggle, input => input.checked), "Default survives reload")
  assert.deepEqual(await consent(), initial, "Reload keeps the same identifier")
  await h.options.click(toggle)
  await waitFor(() => consent().then(value => value.enabled === false && value.distinctId === null), "Opt-out clears the identifier")
  await h.reloadOptions()
  await waitFor(() => h.options.$eval(toggle, input => !input.checked), "Opt-out survives reload")
  assert.deepEqual(await consent(), { enabled: false, distinctId: null })
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.click("Read this page with Orateur")
  await waitFor(() => h.speech().then(state => state.spoken.length), "Reading works after opting out")
  assert.equal(h.blocked.some(url => /posthog/.test(url)), false, "Opted-out reading sends no statistics")
})

browserTest("counts the first audible start once across pause, speed changes and paragraphs", async h => {
  await prepare(h)
  assert.deepEqual(await events(h), [], "A queued utterance is not an audible start")
  await emit(h, 0, "start")
  await waitFor(() => events(h).then(events => events.length === 1), "First audio start observed")
  await h.click("Pause")
  await h.click("Resume reading")
  await h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    const key = "orateur:reader-prefs"
    const stored = await api.storage.local.get(key)
    await api.storage.local.set({ [key]: { ...stored[key], speed: 1.25 } })
  })
  await countUtterances(h, 2)
  await emit(h, 1, "start")
  await emit(h, 1, "end")
  await countUtterances(h, 3)
  await emit(h, 2, "start")
  await emit(h, 2, "end")
  await countUtterances(h, 4)
  await emit(h, 3, "start")
  await emit(h, 3, "end")
  await waitFor(() => events(h).then(events => events.length === 2), "Natural completion observed")
  assert.deepEqual(await events(h), [
    { name: "read_started", properties: { engine: "system" } },
    { name: "read_completed", properties: { engine: "system", had_errors: false } },
  ])
  assert.equal(h.blocked.some(url => /posthog/.test(url)), false, "Statistics remain off after opting out")
})

browserTest("failed synthesis before any audio never counts an activation or completion", async h => {
  await prepare(h)
  for (let index = 0; index < 3; index++) {
    await emit(h, index, "error")
    if (index < 2) await countUtterances(h, index + 2)
  }
  await waitFor(() => h.shadow(reader, 'button[aria-label="Read this page with Orateur"]'), "Failed queue returns to idle")
  await waitFor(() => events(h).then(events => events.length === 1), "Failure observed")
  assert.deepEqual(await events(h), [
    { name: "read_failed", properties: { engine: "system", reason: "synthesis" } },
  ])
})

browserTest("marks completion after skipped errors and ignores callbacks from a stopped reading", async h => {
  await prepare(h)
  await emit(h, 0, "start")
  await emit(h, 0, "end")
  await countUtterances(h, 2)
  await emit(h, 1, "error")
  await countUtterances(h, 3)
  await emit(h, 2, "error")
  await waitFor(() => events(h).then(events => events.length === 3), "Failure and completion observed")
  assert.deepEqual(await events(h), [
    { name: "read_started", properties: { engine: "system" } },
    { name: "read_failed", properties: { engine: "system", reason: "synthesis" } },
    { name: "read_completed", properties: { engine: "system", had_errors: true } },
  ])
  await h.click("Read this page with Orateur")
  await countUtterances(h, 4)
  await h.click("Stop reading")
  await emit(h, 3, "start")
  await emit(h, 3, "end")
  await h.click("Read this page with Orateur")
  await countUtterances(h, 5)
  await emit(h, 3, "error")
  await emit(h, 4, "start")
  await waitFor(() => events(h).then(events => events.length === 4), "New reading counted separately")
  assert.deepEqual((await events(h)).at(-1), { name: "read_started", properties: { engine: "system" } })
  await h.click("Stop reading")
})
