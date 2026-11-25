import assert from "node:assert/strict"
import { browserTest, waitFor } from "../support/browser.mjs"
import { KALE_FILES } from "../../lib/kale/asset-files.ts"
import { KALE_ASSET_ROOT, KALE_CACHE_NAME, KALE_GRAPHS } from "../../lib/kale/model-cache.ts"

const reader = "orateur-reader-pill"
const button = (label) => `button[aria-label=${JSON.stringify(label)}]`

async function seedModels(h, withGpu = false) {
  const paths = Object.keys(KALE_FILES).filter(path => withGpu || path !== KALE_GRAPHS.webgpu)
  await h.options.evaluate(async ({ url, paths, root, name }) => {
    const cache = await caches.open(name)
    for (const path of paths) {
      const response = await fetch(`${url}/kale-assets/${path}`)
      if (!response.ok) throw new Error(`Missing Kale fixture ${path}`)
      await cache.put(root + path, response)
    }
  }, { url: h.url, paths, root: KALE_ASSET_ROOT, name: KALE_CACHE_NAME })
}

browserTest("Kale reads an English article and selection from its verified cache", async (h) => {
  await h.install()
  await seedModels(h)
  await h.options.$eval('a[href="#voix"]', (element) => element.click())
  await h.options.$eval('input[name="engine"][value="kale"]', (element) => element.click())
  const picker = '#voix select[aria-labelledby="voice-picker-label"]'
  await waitFor(() => h.options.$eval(picker, select => select.options.length === 10).catch(() => false), "Kale's ten voices are available")
  await h.options.select(picker, "d03")
  await waitFor(() => h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    const prefs = (await api.storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"]
    return prefs?.engine === "kale" && prefs.kaleVoice === "d03"
  }), "Kale and Amy are saved")

  // The GPU graph is unavailable from this test's rejecting proxy. The same
  // English sample must play with the saved CPU graph even if WebGPU was chosen.
  await h.options.$eval('#voix input[aria-describedby="kale-webgpu-note"]', input => input.click())
  await waitFor(() => h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    return (await api.storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"].kaleWebGpu === true
  }), "WebGPU preference is saved")

  await h.page.goto(`${h.url}/english-article`)
  await h.page.waitForSelector(reader)
  await h.fakeSpeech()
  await h.click("Read this page with Orateur")
  await waitFor(() => h.shadow(reader, button("Pause")), "The real Kale audio starts", 30_000)
  await h.click("Pause")
  await h.click("Resume reading")
  await h.click("Next paragraph")
  await waitFor(() => h.shadow(reader, button("Pause")), "Kale plays again after seeking", 30_000)
  await h.click("Stop reading")
  await waitFor(() => h.shadow(reader, button("Read this page with Orateur")), "Stopped reading folds the pill")

  await h.page.$eval("#selection", (paragraph) => {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })
  await h.click("Listen to selection with Orateur", h.page, "orateur-selection-bubble")
  await waitFor(() => h.shadow(reader, button("Pause")), "A selection also produces real Kale audio", 30_000)
  await h.click("Stop reading")
  assert.deepEqual((await h.speech()).spoken, [], "English stays on Kale")
  assert.ok(h.blocked.filter(url => /huggingface|hf\.co/.test(url)).length <= 1, "Only the optional GPU download may be attempted")
}, { skip: !process.env.ORATEUR_KALE_FIXTURES, timeout: 90_000 })

browserTest("Kale synthesizes with the FP32 graph on an available WebGPU adapter", async (h) => {
  await h.install()
  await seedModels(h, true)
  const result = await h.options.evaluate(async () => {
    const api = globalThis.browser ?? chrome
    const worker = new Worker(api.runtime.getURL("/kale-worker.js"), { type: "module" })
    return await new Promise(resolve => {
      const timer = setTimeout(() => finish({ error: "WebGPU worker did not respond" }), 30_000)
      function finish(value) {
        clearTimeout(timer)
        worker.terminate()
        resolve(value)
      }
      worker.onerror = error => finish({ error: error.message })
      worker.onmessage = ({ data }) => {
        if (data.phase) return
        finish(data.pcm ? {
          samples: data.pcm.length, peak: data.pcm.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0),
        } : data)
      }
      worker.postMessage({ text: "The ferry leaves at ten thirty.", voice: "d03", webGpu: true, cacheOnly: true })
    })
  })
  assert.ok(result.samples >= 24000 && result.peak > 0.01, JSON.stringify(result))
  assert.equal(h.blocked.some(url => /huggingface|hf\.co/.test(url)), false)
}, { skip: !process.env.ORATEUR_KALE_GPU_FIXTURE || !process.env.ORATEUR_KALE_FIXTURES, timeout: 90_000 })
