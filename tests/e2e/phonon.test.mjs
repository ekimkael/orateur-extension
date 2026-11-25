import assert from "node:assert/strict"
import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"
import { PHONON_FILES } from "../../lib/phonon/config.ts"
import { browserTest, waitFor } from "../support/browser.mjs"

const source = process.env.ORATEUR_PHONON_MANIFEST
const directory = process.env.ORATEUR_PHONON_FIXTURES
const englishOnly = process.env.ORATEUR_PHONON_EN_ONLY === "1"

browserTest("Phonon loads verified assets and plays without a Hugging Face session", async (h, t) => {
  const manifest = JSON.parse(await readFile(source, "utf8"))
  const base = new URL(manifest.baseUrl)
  assert.equal(base.hostname, "127.0.0.1")
  const requests = []
  let fail = true
  let interruptWeights = true
  const server = createServer((req, res) => {
    const entry = Object.entries(PHONON_FILES).find(([, name]) => req.url === base.pathname + name)
    if (!entry) return res.writeHead(404).end()
    const [key, name] = entry
    const { range, cookie, authorization } = req.headers
    requests.push({ key, range, cookie, authorization })
    if (fail) return res.writeHead(503).end()
    const size = manifest.files[key].size
    const offset = range && /^bytes=(\d+)-$/.exec(range)
    const start = offset ? Number(offset[1]) : 0
    if (range && (!offset || start >= size)) return res.writeHead(416).end()
    res.writeHead(range ? 206 : 200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Range",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Length": size - start,
      ...(range && { "Content-Range": `bytes ${start}-${size - 1}/${size}` }),
    })
    const cut = key === "weights" && interruptWeights && !range
    if (cut) interruptWeights = false
    const stream = createReadStream(join(directory, name), { start, end: cut ? 256 * 1024 - 1 : size - 1 })
    stream.on("error", () => res.destroy())
    res.on("close", () => stream.destroy())
    if (cut) stream.once("end", () => setTimeout(() => res.destroy(), 200))
    stream.pipe(res, { end: !cut })
  })
  await new Promise((resolve, reject) => server.once("error", reject).listen(Number(base.port), base.hostname, resolve))
  t.after(() => { server.closeAllConnections(); server.close() })

  await h.install()
  await h.page.reload()
  await h.click("Reading settings")
  assert.equal(await h.script(() => {
    const pill = document.querySelector("orateur-reader-pill")
    const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(pill) ?? pill?.openOrClosedShadowRoot
    const engine = root?.querySelector('select:has(option[value="phonon"])')
    if (!engine) return null
    engine.value = "phonon"
    engine.dispatchEvent(new Event("change", { bubbles: true }))
    return engine.selectedOptions[0]?.textContent
  }), "Phonon")
  await waitFor(() => h.options.evaluate(async () => {
    const key = "orateur:reader-prefs"
    return (await (globalThis.browser ?? chrome).storage.local.get(key))[key]?.engine === "phonon"
  }), "Phonon is saved")

  async function play(path) {
    await h.page.goto(h.url + path)
    await h.click("Read this page with Orateur")
  }
  const reader = "orateur-reader-pill"
  const pause = 'button[aria-label="Pause"]'
  await play("/english-article")
  await waitFor(() => h.shadow(reader, 'button[aria-label="Retry reading"]'), "An unavailable download can be retried")
  assert.deepEqual(requests.map(({ key }) => key), ["weights"])
  fail = false
  await h.click("Retry reading")
  await waitFor(() => h.shadow(reader, pause), "English audio started", 35_000)
  await h.click("Pause")
  await h.click("Resume reading")
  await h.click("Stop reading")

  if (!englishOnly) {
    await play("/article")
    await waitFor(() => h.shadow(reader, pause), "French audio started", 35_000)
    await h.click("Stop reading")
    assert.equal(requests.filter(({ key }) => key === "fr").length, 1)

    // Switching back to English reloads the model in its worker. Both voices
    // must still work from storage when the asset server is unavailable.
    fail = true
    const downloaded = requests.length
    for (const path of ["/english-article", "/article"]) {
      await h.page.goto(h.url + path)
      await h.page.$eval("article p", (paragraph) => {
        if (document.documentElement.lang === "fr") paragraph.textContent = "Le billet coûte 500 FCFA."
        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        selection.removeAllRanges()
        selection.addRange(range)
        paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      })
      await h.click("Listen to selection with Orateur", h.page, "orateur-selection-bubble")
      await waitFor(() => h.shadow(reader, pause), `Selection started with the asset server unavailable (${path})`, 35_000)
      await h.click("Stop reading")
    }
    assert.equal(requests.length, downloaded)
  }
  const weightRequests = requests.filter(({ key }) => key === "weights")
  assert.deepEqual(weightRequests.map(({ range }) => range), [undefined, undefined, "bytes=262144-"],
    "One unavailable request, one interrupted download and one resumed download shared across languages")
  assert.ok(requests.every(({ authorization, cookie }) => !authorization && !cookie))
  assert.equal(h.blocked.some(url => /huggingface/.test(url)), false)
}, { skip: !source || !directory, timeout: 90_000 })
