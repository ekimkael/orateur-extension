import assert from "node:assert/strict"
import { browserTest, waitFor } from "../support/browser.mjs"

browserTest("Pocket voice settings stay independent and preserve pronunciation rules", async h => {
  await h.install({ engine: "supertonic" })
  await h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    await api.storage.local.set({
      "orateur:reader-prefs": { engine: "supertonic", supertonicVoice: "F2", voiceURI: "old-system-voice" },
      "orateur:pronunciation-rules": [{ id: "old-rule", source: "GitHub", replacement: "Git Hub", language: "en", caseSensitive: false }],
    })
  })

  const clickOption = selector => h.options.$eval(selector, element => element.click())
  await clickOption('a[href="#voix"]')
  const picker = '#voix select[aria-labelledby="voice-picker-label"]'
  const selectedVoice = () => h.options.$eval(picker, select => select.value).catch(() => null)
  const storedPrefs = () => h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    return (await api.storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"]
  })
  await waitFor(async () => await selectedVoice() === "F2", "Existing Supertonic voice is selected")

  await h.page.reload()
  await h.page.waitForSelector("orateur-reader-pill")
  await h.click("Reading settings")
  // Firefox cannot activate privileged extension tabs through BiDi.
  await clickOption('input[name="engine"][value="pocket"]')
  await waitFor(async () => await selectedVoice() === "auto", "Automatic Pocket voice is selected")
  await waitFor(async () => (await storedPrefs()).engine === "pocket", "Pocket engine is saved")
  await h.options.select(picker, "estelle")
  const prefs = await waitFor(async () => {
    const current = await storedPrefs()
    return current.pocketVoice === "estelle" && current
  }, "Pocket voice is saved")
  assert.equal(prefs.supertonicVoice, "F2")
  assert.equal(prefs.voiceURI, "old-system-voice")
  await waitFor(async () => await h.script(() => {
    const host = document.querySelector("orateur-reader-pill")
    const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(host) ?? host?.openOrClosedShadowRoot
    return root?.querySelector("#orateur-voice")?.value
  }) === "estelle", "The reader updates its voice catalog after the engine changes in Settings")

  await clickOption('a[href="#prononciation"]')
  const listen = '#prononciation button[aria-label="Listen to the rule for GitHub"]'
  await h.options.waitForSelector(listen, { visible: true })
  assert.equal(await h.options.$eval(listen, button => button.disabled), true)
  assert.match(await h.options.$eval('#prononciation [role="status"]', status => status.textContent), /Supertonic.*system voice/i)

  await clickOption('a[href="#voix"]')
  await clickOption('input[name="engine"][value="system"]')
  await clickOption('a[href="#prononciation"]')
  await waitFor(() => h.options.$eval(listen, button => !button.disabled), "The original rule can still be previewed with system voices")
})
