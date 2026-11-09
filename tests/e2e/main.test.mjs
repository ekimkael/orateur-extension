import assert from "node:assert/strict"
import { browserTest, browserName, waitFor } from "../support/browser.mjs"

const reader = "orateur-reader-pill"
const read = "Read this page with Orateur"

browserTest("installs the production ZIP and persists settings through a page reload", async h => {
  await h.install()
  assert.match(await h.options.title(), /Orateur/)
  await h.options.select("#general select", "fr")
  await waitFor(() => h.options.$eval("html", html => html.lang === "fr"), "French settings applied")
  await h.reloadOptions()
  await h.options.waitForSelector("h1")
  assert.equal(await h.options.$eval("#general select", select => select.value), "fr")
  assert.equal(await h.options.$eval("html", html => html.lang), "fr")
  await h.page.reload()
  await h.page.waitForSelector(reader)
  // The production roots stay closed, even under test.
  assert.equal(await h.page.$eval(reader, host => host.shadowRoot), null)
})

browserTest("reads an already-open article, then pauses, resumes and stops", async h => {
  await h.install()
  if (browserName === "chrome") assert.equal(await h.page.$(reader), null, "Chrome page predates installation")
  await h.fakeSpeech()
  assert.equal(await h.script(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: "orateur:read-page" })), true)
  await waitFor(() => h.page.title().then(title => title.startsWith("🔊 ")), "Reading marks the article tab")
  const speech = await waitFor(() => h.speech().then(state => state.spoken.length && state), "Extracted article is spoken")
  assert.match(speech.spoken[0].text, /Orateur permet de lire/)
  await h.click("Pause")
  await waitFor(() => h.speech().then(state => state.paused), "Pause reaches the speech engine")
  await h.click("Resume reading")
  await waitFor(() => h.speech().then(state => !state.paused), "Resume reaches the speech engine")
  await h.click("Stop reading")
  await waitFor(() => h.page.title().then(title => title === "Une lecture de contrôle"), "Stop restores the title")
  await waitFor(() => h.shadow(reader, `button[aria-label="${read}"]`), "Reader returns to idle")
  assert.equal(h.blocked.some(url => /posthog|orateur\.digitalekim|huggingface/.test(url)), false, "Local reading needs no external service")
})

browserTest("a finished article thanks the listener and offers support", async h => {
  await h.install()
  await h.options.evaluate(() => {
    globalThis.__supportEvents = []
    ;(globalThis.browser ?? chrome).runtime.onMessage.addListener(message => {
      if (message?.type === "orateur:telemetry:track") globalThis.__supportEvents.push(message.event.name)
    })
  })
  // A hidden tab holds the toast's countdown and its announcement frame.
  await h.page.bringToFront()
  await h.fakeSpeech(h.page, { finish: true })
  assert.equal(await h.script(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: "orateur:read-page" })), true)
  await waitFor(() => h.speech().then(state => /^Fin de l'article, merci d'avoir écouté\. Orateur est développé/.test(state.spoken.at(-1)?.text ?? "")), "The outro thanks and asks for support")
  const shown = await waitFor(() => h.shadow(reader, ".pill-toast").then(value => value && !value.hidden && value.text.includes("Thanks for listening") && value), "The support toast replaces the pill")
  assert.match(shown.text, /Support/)
  const link = await h.script(() => {
    const host = document.querySelector("orateur-reader-pill")
    const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(host) ?? host.openOrClosedShadowRoot
    const a = root.querySelector('.pill-toast a[data-icon="heart"]')
    return a && { href: a.href, target: a.target, rel: a.rel }
  })
  assert.deepEqual(link, { href: "https://bikiekrb.mychariow.online/prd_bs2lca7z/checkout", target: "_blank", rel: "noopener noreferrer" })
  await waitFor(() => h.options.evaluate(() => globalThis.__supportEvents.includes("support_prompt_shown")), "The toast is counted")

  // A new reading during the toast takes the controls back. The burst of
  // instant paragraphs can leave saved progress behind: skip the resume prompt.
  await h.script(() => { globalThis.confirm = () => false })
  await h.fakeSpeech()
  assert.equal(await h.script(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: "orateur:read-page" })), true)
  await waitFor(() => h.shadow(reader, 'button[aria-label="Pause"]').then(value => value?.width > 0), "The new reading shows its controls")
  assert.equal((await h.shadow(reader, ".pill-toast"))?.hidden ?? true, true, "The toast is gone")
  await h.click("Stop reading")
})

browserTest("the support toast can stop the outro while it speaks", async h => {
  await h.install()
  await h.page.bringToFront()
  await h.fakeSpeech(h.page, { finish: true, hold: "^Fin de l'article" })
  assert.equal(await h.script(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: "orateur:read-page" })), true)
  await waitFor(() => h.speech().then(state => /^Fin de l'article/.test(state.spoken.at(-1)?.text ?? "")), "The outro is speaking")
  const stop = '.pill-toast button[aria-label="Stop reading"]'
  const button = await waitFor(() => h.shadow(reader, stop).then(value => value?.width > 0 && value), "The toast offers to stop the voice")
  const cancelled = (await h.speech()).cancelled
  await h.page.mouse.click(button.x, button.y)
  await waitFor(() => h.speech().then(state => state.cancelled > cancelled), "Stop silences the outro")
  await waitFor(() => h.shadow(reader, stop).then(value => !value || value.width === 0), "The stop button leaves with the voice")
  const toast = await h.shadow(reader, ".pill-toast")
  assert.equal(toast?.hidden, false, "The support link stays")
})

browserTest("the support toast gives the pill back once the voice is done", async h => {
  await h.install()
  // A hidden tab holds the toast's countdown and its announcement frame.
  await h.page.bringToFront()
  await h.fakeSpeech(h.page, { finish: true })
  assert.equal(await h.script(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: "orateur:read-page" })), true)
  await waitFor(() => h.shadow(reader, ".pill-toast").then(value => value && !value.hidden), "The support toast is shown")
  await waitFor(() => h.shadow(reader, `button[aria-label="${read}"]`).then(value => value?.width > 0), "The pill returns to idle", 14_000)
})

browserTest("Settings offer support in their own section and in the footer", async h => {
  await h.install()
  const donation = "https://bikiekrb.mychariow.online/prd_bs2lca7z/checkout"
  const footer = await h.options.$eval(".foot-support", a => ({ href: a.href, target: a.target, text: a.textContent }))
  assert.deepEqual(footer, { href: donation, target: "_blank", text: "Support" })
  await h.options.click('a[href="#soutien"]')
  await h.options.waitForSelector("#soutien", { visible: true })
  assert.match(await h.options.$eval("#soutien", section => section.textContent), /Support Orateur.*built by one person.*Donate/s)
  assert.equal(await h.options.$eval("#soutien .support-cta", a => a.href), donation)
})

browserTest("a fresh install defaults to Supertonic", async h => {
  await h.install({ engine: null })
  const prefs = await waitFor(() => h.options.evaluate(async () => {
    const stored = (await (globalThis.browser ?? chrome).storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"]
    return stored?.engine && stored
  }), "Initial engine preference saved")
  assert.equal(prefs.engine, "supertonic")
})

browserTest("a private context without cached models uses the system voice without downloading", async h => {
  await h.install({ engine: "supertonic" })
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.script(() => {
    Object.defineProperty((globalThis.browser ?? chrome).extension, "inIncognitoContext", { value: true })
  })
  await h.click(read)
  const spoken = await waitFor(() => h.speech().then(state => state.spoken[0]), "Private reading reaches the system engine")
  assert.match(spoken.text, /Orateur permet de lire/)
  await waitFor(async () => {
    const notice = await h.options.evaluate(async () => {
      const api = globalThis.browser ?? chrome
      return (api.action ?? api.browserAction).getTitle({})
    })
    return /Private window: reading with the system voice/.test(notice)
  }, "Private fallback notification is visible")
  assert.equal(h.blocked.some(url => /huggingface/.test(url)), false, "Private reading never requests model downloads")
})

browserTest("switching engine mid-reading stops the running engine", async h => {
  await h.install()
  await h.fakeSpeech()
  assert.equal(await h.script(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: "orateur:read-page" })), true)
  await waitFor(() => h.speech().then(state => state.spoken.length), "System reading starts")
  await h.click("Pause")
  await h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    const key = "orateur:reader-prefs"
    const prefs = (await api.storage.local.get(key))[key]
    await api.storage.local.set({ [key]: { ...prefs, engine: "supertonic" } })
  })
  // Before the fix, Play resumed the paused system voice despite the switch.
  await waitFor(() => h.shadow(reader, `button[aria-label="${read}"]`), "Reader returns to idle after the switch")
})

browserTest("mouse selection exposes the bubble and reads only the selected text", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.page.bringToFront()
  const points = await h.page.$eval("#selection", paragraph => {
    const text = paragraph.firstChild
    const range = document.createRange()
    range.setStart(text, 0); range.setEnd(text, 1)
    const start = range.getBoundingClientRect()
    range.setStart(text, text.length - 1); range.setEnd(text, text.length)
    const end = range.getBoundingClientRect()
    return { start: { x: start.x, y: start.y + start.height / 2 }, end: { x: end.right, y: end.y + end.height / 2 } }
  })
  await h.page.mouse.move(points.start.x, points.start.y)
  await h.page.mouse.down()
  await h.page.mouse.move(points.end.x, points.end.y, { steps: 12 })
  await h.page.mouse.up()
  const selected = await h.page.evaluate(() => window.getSelection().toString().trim())
  assert.equal(selected, await h.page.$eval("#selection", paragraph => paragraph.textContent))
  await h.click("Listen to selection with Orateur", h.page, "orateur-selection-bubble")
  const speech = await waitFor(() => h.speech().then(state => state.spoken.length && state), "Selection reaches speech engine")
  assert.equal(speech.spoken[0].text, selected)
})

browserTest("only the most recently started tab keeps playing", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.click(read)
  await waitFor(() => h.shadow(reader, 'button[aria-label="Pause"]'), "First tab is playing")
  const next = await h.browser.newPage()
  await next.goto(`${h.url}/second-article`)
  await next.waitForSelector(reader)
  await h.fakeSpeech(next)
  await h.click(read, next)
  await waitFor(() => h.shadow(reader, 'button[aria-label="Pause"]', next), "Second tab is playing")
  await waitFor(() => h.shadow(reader, `button[aria-label="${read}"]`), "First tab relinquishes playback")
  await waitFor(() => h.speech(next).then(state => state.spoken.length), "New owner sends text to the speech engine")
})

browserTest("an unreadable page shows a recoverable error instead of hanging", async h => {
  await h.install()
  await h.page.goto(`${h.url}/empty`)
  await h.page.waitForSelector(reader)
  await h.click(read)
  const alert = await waitFor(() => h.shadow(reader, '[role="alert"]'), "Visible reading error")
  assert.match(alert.text, /Unable to read/)
  await waitFor(() => h.shadow(reader, 'button[aria-label="Retry reading"]'), "Retry remains available")
})

browserTest("keyboard controls start and pause the reader", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.page.bringToFront()
  await h.page.click("h1")
  await h.page.keyboard.press("Tab")
  await h.page.keyboard.press("Enter")
  await waitFor(() => h.shadow(reader, 'button[aria-label="Pause"]'), "Keyboard starts playback")
  const focusedLabel = () => h.script(() => {
    const host = document.querySelector("orateur-reader-pill")
    const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(host) ?? host.openOrClosedShadowRoot
    return root.activeElement?.getAttribute("aria-label")
  })
  // Loading disables the primary control and may move browser focus.
  if (await focusedLabel() !== "Pause") {
    await h.page.keyboard.press("Tab")
    if (await focusedLabel() !== "Pause") {
      await h.page.keyboard.down("Shift")
      await h.page.keyboard.press("Tab")
      await h.page.keyboard.up("Shift")
    }
  }
  assert.equal(await focusedLabel(), "Pause", "Pause is reachable through normal tab order")
  assert.equal(await h.page.evaluate(() => document.hasFocus()), true)
  await h.page.keyboard.press("Enter")
  await waitFor(() => h.shadow(reader, 'button[aria-label="Resume reading"]'), "Keyboard pauses playback")
  assert.equal((await h.speech()).paused, true)
})

browserTest("paragraph navigation and speed changes reach the speech engine", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.click(read)
  await waitFor(() => h.speech().then(state => state.spoken.length), "Initial paragraph starts")
  await h.click("Next paragraph")
  await waitFor(() => h.speech().then(state => state.spoken.some(item => item.text.includes("deuxième paragraphe"))), "Next paragraph reaches the engine")
  await h.click("Reading settings")
  await h.page.bringToFront()
  // Focus without changing the track value: a pending pointer write can race the keys.
  await waitFor(() => h.script(() => {
    const host = document.querySelector("orateur-reader-pill")
    const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(host) ?? host.openOrClosedShadowRoot
    const speed = root.querySelector('input[type="range"]')
    if (!speed?.getBoundingClientRect().width) return false
    speed.focus()
    return document.hasFocus() && root.activeElement === speed
  }), "Speed control receives keyboard focus")
  await h.page.keyboard.press("Home")
  await waitFor(() => h.speech().then(state => Math.abs(state.spoken.at(-1)?.rate - 0.8) < 1e-6), "Minimum speed reaches the engine before incrementing")
  await h.page.keyboard.press("ArrowRight")
  await h.page.keyboard.press("Tab")
  // SpeechSynthesisUtterance.rate is a Web IDL float, so 0.9 is rounded.
  await waitFor(() => h.speech().then(state => Math.abs(state.spoken.at(-1)?.rate - 0.9) < 1e-6), "Speed change applies to current paragraph")
})

browserTest("excluded sites hide the injected reader and can be restored", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.options.click('a[href="#sites"]')
  await h.options.waitForSelector("#site-input", { visible: true })
  await h.options.type("#site-input", "127.0.0.1")
  await h.options.click('#sites button[type="submit"]')
  await waitFor(() => h.page.$(reader).then(host => !host), "Excluded site's reader disappears")
  await h.options.waitForSelector('button[aria-label="Stop hiding Orateur on 127.0.0.1"]', { visible: true })
  await h.options.click('button[aria-label="Stop hiding Orateur on 127.0.0.1"]')
  await h.page.waitForSelector(reader)
})

const hidePill = "Stop showing Orateur on this site"
const toast = ".pill-toast"
const hiddenSites = h => h.options.evaluate(async () =>
  (await (globalThis.browser ?? chrome).storage.local.get("orateur:hidden-sites"))["orateur:hidden-sites"] ?? [])
const pillFocus = h => h.script(() => {
  const host = document.querySelector("orateur-reader-pill")
  const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(host) ?? host.openOrClosedShadowRoot
  return root.activeElement?.getAttribute("aria-label") ?? null
})

browserTest("the close button hides Orateur on the site behind a toast that can undo it", async h => {
  await h.install()
  await h.options.evaluate(() => {
    globalThis.__pillEvents = []
    ;(globalThis.browser ?? chrome).runtime.onMessage.addListener(message => {
      if (message?.type === "orateur:telemetry:track") globalThis.__pillEvents.push(message.event)
    })
  })
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.click(hidePill)
  const shown = await waitFor(() => h.shadow(reader, toast).then(value => value && !value.hidden && value), "A toast replaces the pill")
  assert.match(shown.text, /Orateur hidden on this site/)
  await waitFor(async () => (await hiddenSites(h)).includes("127.0.0.1"), "The site is hidden at once")
  // Undo ignores pointer clicks in its first 500 ms (the second half of a double-click on ✕).
  await new Promise(resolve => setTimeout(resolve, 600))
  await h.click("Undo")
  await waitFor(() => h.shadow(reader, `button[aria-label="${read}"]`).then(value => value?.width > 0), "Undo brings the pill back")
  await waitFor(async () => (await hiddenSites(h)).length === 0, "Undo removes the site")
  assert.equal((await h.shadow(reader, toast))?.hidden ?? true, true, "The toast is gone")
  assert.deepEqual(await h.options.evaluate(() => globalThis.__pillEvents), [{ name: "pill_hidden" }, { name: "pill_hide_undone" }])
})

browserTest("the hide toast leaves after five seconds, or at once with Escape, and the site stays hidden", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.click(hidePill)
  await waitFor(() => h.shadow(reader, toast), "The toast is shown")
  await waitFor(() => h.page.$(reader).then(host => !host), "The toast leaves and the pill is detached", 9_000)
  assert.deepEqual(await hiddenSites(h), ["127.0.0.1"])

  await h.options.evaluate(() => (globalThis.browser ?? chrome).storage.local.set({ "orateur:hidden-sites": [] }))
  await h.page.waitForSelector(reader)
  await h.page.bringToFront()
  await h.page.click("h1")
  for (let presses = 0; presses < 4 && await pillFocus(h) !== hidePill; presses++) await h.page.keyboard.press("Tab")
  assert.equal(await pillFocus(h), hidePill, "The close button is reachable by keyboard")
  await h.page.keyboard.press("Enter")
  await waitFor(async () => await pillFocus(h) === "Undo", "Keyboard focus moves to Undo")
  await h.page.keyboard.press("Escape")
  await waitFor(() => h.page.$(reader).then(host => !host), "Escape closes the toast at once")
  assert.deepEqual(await hiddenSites(h), ["127.0.0.1"])
})

browserTest("keyboard focus holds the hide toast, and leaving it resumes the countdown", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.page.bringToFront()
  await h.page.click("h1")
  for (let presses = 0; presses < 4 && await pillFocus(h) !== hidePill; presses++) await h.page.keyboard.press("Tab")
  await h.page.keyboard.press("Enter")
  await waitFor(async () => await pillFocus(h) === "Undo", "Keyboard focus moves to Undo")
  await new Promise(resolve => setTimeout(resolve, 5_500))
  assert.ok(await h.shadow(reader, toast), "Focus on Undo holds the toast past five seconds")
  await h.page.keyboard.press("Tab")
  await new Promise(resolve => setTimeout(resolve, 1_000))
  assert.ok(await h.page.$(reader), "Leaving the toast resumes the countdown instead of ending it at once")
  await waitFor(() => h.page.$(reader).then(host => !host), "The toast leaves once the countdown ends", 9_000)
})

browserTest("a double click on the close button keeps the site hidden", async h => {
  await h.install()
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.page.bringToFront()
  const close = await waitFor(() => h.shadow(reader, `button[aria-label="${hidePill}"]`), "Close button")
  await h.page.mouse.click(close.x, close.y, { count: 2 })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.ok(await h.shadow(reader, toast), "The second click does not undo")
  assert.deepEqual(await hiddenSites(h), ["127.0.0.1"])
})

browserTest("hiding from the error card shows only the toast", async h => {
  await h.install()
  await h.page.goto(`${h.url}/empty`)
  await h.page.waitForSelector(reader)
  await h.click(read)
  await waitFor(() => h.shadow(reader, '[role="alert"]'), "Visible reading error")
  await h.click(hidePill)
  await waitFor(() => h.shadow(reader, toast).then(value => value && !value.hidden), "The toast is shown")
  assert.equal((await h.shadow(reader, ".pill-content"))?.hidden, true, "The error text gives way to the toast")
  assert.equal(await h.page.$eval(reader, host => host.hasAttribute("data-expanded")), false, "The card folds into the toast")
})

browserTest("an unavailable neural model shows an error and keeps retry available", async h => {
  await h.install()
  await h.options.click('a[href="#voix"]')
  await h.options.waitForSelector('input[name="engine"][value="supertonic"]', { visible: true })
  await h.options.click('input[name="engine"][value="supertonic"]')
  await waitFor(() => h.options.evaluate(async () => ((await (globalThis.browser ?? chrome).storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"]?.engine === "supertonic")), "Neural engine preference saved")
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.click(read)
  const alert = await waitFor(() => h.shadow(reader, '[role="alert"]'), "Model download failure is visible", 20_000)
  assert.match(alert.text, /Unable to read/)
  assert.ok(h.blocked.some(url => /huggingface/.test(url)), "Actual model request reaches the rejecting test proxy")
  await waitFor(() => h.shadow(reader, 'button[aria-label="Retry reading"]'), "Neural failure allows retry")
})

browserTest("a blocked Pocket model download keeps the saved engine and allows retry", async h => {
  await h.install({ engine: "pocket" })
  await h.page.reload()
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.click(read)
  const alert = await waitFor(() => h.shadow(reader, '[role="alert"]'), "Pocket model failure is visible", 20_000)
  assert.match(alert.text, /Unable to read/)
  assert.ok(h.blocked.includes("huggingface.co:443"), "The model download reaches the rejecting proxy")
  assert.equal(h.blocked.some(url => /posthog|orateur\.digitalekim/.test(url)), false)
  assert.equal((await h.speech()).spoken.length, 0, "A failed download does not silently change the voice")
  assert.equal(await h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    return (await api.storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"].engine
  }), "pocket")
  await waitFor(() => h.shadow(reader, 'button[aria-label="Retry reading"]'), "Pocket failure allows retry")
})

browserTest("Pocket uses a system voice for unsupported languages without changing the preference", async h => {
  await h.install({ engine: "pocket" })
  await h.page.goto(`${h.url}/german-article`)
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.click(read)
  await waitFor(() => h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    const expected = api.i18n.getMessage("noticePocketLangUnsupported")
    return Boolean(expected) && (await (api.action ?? api.browserAction).getTitle({})) === expected
  }), "Pocket fallback is explained")
  const spoken = await waitFor(() => h.speech().then(state => state.spoken[0]), "German article reaches the system voice")
  assert.match(spoken.text, /Dieser deutsche Artikel/)
  assert.equal(spoken.lang, "de")
  assert.equal(h.blocked.some(url => /huggingface/.test(url)), false, "Unsupported languages do not start a model download")
  assert.equal(await h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    return (await api.storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"].engine
  }), "pocket")
})

browserTest("pronunciation rules validate, persist, edit and delete through the settings UI", async h => {
  await h.install()
  await h.options.click('a[href="#prononciation"]')
  await h.options.waitForSelector('input[name="source"]:enabled', { visible: true })
  await h.options.type('input[name="source"]', "Orateur")
  await h.options.type('input[name="replacement"]', "Orateur de contrôle")
  await h.options.click('#prononciation button[type="submit"]')
  await waitFor(() => h.options.$eval('#prononciation', section => section.textContent.includes('Orateur de contrôle') && section.querySelector('input[name="source"]').value === ""), "Rule saved")
  await h.reloadOptions()
  await h.options.waitForSelector('button[aria-label="Edit the rule for Orateur"]')
  await h.options.click('button[aria-label="Edit the rule for Orateur"]')
  await h.options.click('input[name="source"]', { clickCount: 3 })
  await h.options.type('input[name="source"]', "x".repeat(121))
  await h.options.click('#prononciation button[type="submit"]')
  const alert = await waitFor(() => h.options.$eval('#prononciation', section => section.querySelector('[role="alert"]')?.textContent), "Long rule is rejected")
  assert.match(alert, /Shorten this text/)
  assert.doesNotMatch(alert, /pronunciationError_/)
  // Validation focuses the invalid field on the next frame and can scroll the form.
  await h.options.locator('button[aria-label="Delete the rule for Orateur"]').click()
  await waitFor(() => h.options.$eval('#prononciation', section => section.textContent.includes('No saved rules.')), "Rule deleted")
})

browserTest("toolbar import transfers extracted content in its fragment", async h => {
  await h.install()
  await h.page.reload()
  await h.page.bringToFront()
  const opened = h.browser.waitForTarget(target => target.url().startsWith("https://orateur.digitalekim.net/articles/new#orateur="))
  const extension = (await h.browser.extensions()).get(h.extensionId)
  await h.page.triggerExtensionAction(extension)
  const target = await opened
  const payload = JSON.parse(decodeURIComponent(new URL(target.url()).hash.slice("#orateur=".length)))
  assert.equal(payload.url, `${h.url}/article`)
  assert.match(payload.content, /Orateur permet de lire/)
  assert.equal(new URL(target.url()).search, "")
}, { skip: browserName !== "chrome" && "Firefox BiDi does not expose toolbar action triggering" })
