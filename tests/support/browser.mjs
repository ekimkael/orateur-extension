import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { setTimeout } from "node:timers/promises"
import test from "node:test"
import puppeteer from "puppeteer"
import { extractPackage } from "./package.mjs"

export const browserName = process.env.ORATEUR_TEST_BROWSER ?? "chrome"
assert.ok(["chrome", "firefox"].includes(browserName), "ORATEUR_TEST_BROWSER must be chrome or firefox")
const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)))
const article = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Une lecture de contrôle</title></head>
<body><article><h1>Une lecture de contrôle</h1>
<p id="selection">Orateur permet de lire un article sans quitter sa page. Ce premier paragraphe contient suffisamment de texte pour vérifier l’extraction et la sélection dans le navigateur.</p>
<p>Le deuxième paragraphe permet de vérifier la navigation, la progression et la reprise de lecture. Chaque scénario utilise un profil neuf afin de conserver des résultats indépendants.</p>
<p>Le dernier paragraphe sert à contrôler la fin du document. Le contenu reste une fixture locale, sans dépendance à un site externe, une authentification ou des publicités.</p>
</article></body></html>`

export async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let value
  do {
    value = await predicate()
    if (value) return value
    await setTimeout(50)
  } while (Date.now() < deadline)
  assert.fail(`${message}; last value: ${JSON.stringify(value)}`)
}

const listen = async (server) => {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  return server.address().port
}

export function browserTest(name, run, options = {}) {
  test(`${browserName}: ${name}`, { timeout: 60_000, ...options }, async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), "orateur-e2e-"))
    const blocked = [], logs = [], errors = []
    const sockets = new Set()
    let browser
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.end(req.url === "/empty" ? "<html><body>Empty page</body></html>" : article)
    })
    // No test may upload fixture text or download live models by accident.
    const proxy = createServer((req, res) => { blocked.push(req.url); res.writeHead(502).end() })
    proxy.on("connect", (req, socket) => { blocked.push(req.url); socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n") })
    for (const listener of [server, proxy]) listener.on("connection", socket => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket))
      socket.on("error", () => {}) // Clients may reset a deliberately rejected proxy tunnel.
    })
    t.after(async () => {
      await browser?.close().catch(() => {})
      for (const socket of sockets) socket.destroy()
      server.closeAllConnections(); proxy.closeAllConnections()
      await Promise.all([new Promise(r => server.close(r)), new Promise(r => proxy.close(r))])
      await rm(temporary, { recursive: true, force: true })
    })
    const port = await listen(server), proxyPort = await listen(proxy)
    const archive = resolve(`.output/orateur-extension-${version}-${browserName}.zip`)
    const pkg = await extractPackage(archive, join(temporary, "extension"))
    const uuid = randomUUID()
    const id = pkg.manifest.browser_specific_settings?.gecko?.id
    browser = await puppeteer.launch({
      browser: browserName,
      headless: true,
      enableExtensions: true,
      userDataDir: join(temporary, "profile"),
      // Mozilla requires this automation mode to inspect extension pages.
      // It applies only to this fresh, temporary, loopback-controlled browser.
      ...(browserName === "firefox" && { env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } }),
      ...(process.env.ORATEUR_BROWSER_PATH && { executablePath: process.env.ORATEUR_BROWSER_PATH }),
      args: browserName === "chrome" ? ["--lang=en-US", `--proxy-server=http://127.0.0.1:${proxyPort}`, "--proxy-bypass-list=localhost;127.0.0.1"] : [],
      extraPrefsFirefox: {
        "intl.locale.requested": "en-US",
        "extensions.webextensions.uuids": JSON.stringify({ [id]: uuid }),
        "network.proxy.type": 1,
        "network.proxy.http": "127.0.0.1", "network.proxy.http_port": proxyPort,
        "network.proxy.ssl": "127.0.0.1", "network.proxy.ssl_port": proxyPort,
        "network.proxy.no_proxies_on": "localhost,127.0.0.1",
      },
    })
    await mkdir(resolve(".output/test-results/e2e"), { recursive: true })
    await writeFile(resolve(`.output/test-results/e2e/${browserName}-runtime.json`), JSON.stringify({
      browser: await browser.version(), executable: browser.process()?.spawnfile, extensionVersion: version,
    }, null, 2) + "\n")
    const observe = (page) => {
      page.on("console", (message) => logs.push({ url: page.url(), type: message.type(), text: message.text() }))
      page.on("pageerror", (error) => errors.push({ url: page.url(), message: String(error) }))
      page.on("dialog", dialog => dialog.dismiss())
    }
    browser.on("targetcreated", target => { void target.page().then(page => { if (page) observe(page) }).catch(() => {}) })
    const page = await browser.newPage()
    observe(page)
    const url = `http://127.0.0.1:${port}`
    await page.goto(`${url}/article`)
    let extensionPage
    const h = {
      browser, page, url, blocked, errors,
      async install({ telemetry = false, engine = "system" } = {}) {
        const extensionId = await browser.installExtension(pkg.directory)
        const origin = browserName === "chrome" ? `chrome-extension://${extensionId}` : `moz-extension://${uuid}`
        extensionPage = await browser.newPage()
        const url = `${origin}/options.html`
        if (browserName === "firefox") {
          // Firefox filters extension lifecycle events out of BiDi. Navigate
          // without waiting for those events, then wait for the actual DOM.
          await browser.connection.send("browsingContext.navigate", { context: extensionPage.mainFrame()._id, url, wait: "none" })
        } else {
          await extensionPage.goto(url)
        }
        await waitFor(() => extensionPage.evaluate(url => location.href === url && Boolean(document.querySelector("h1")), url).catch(() => false), "Packaged extension page is ready")
        h.extensionId = extensionId; h.origin = origin; h.options = extensionPage
        if (engine) {
          // Installs seed the natural voices, which would start the 398 MB
          // model download. Most tests drive the faked system speech engine:
          // wait for the seed so it cannot overwrite this choice afterwards.
          await waitFor(() => extensionPage.evaluate(async () => {
            const api = globalThis.browser ?? chrome
            return Boolean((await api.storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"]?.engine)
          }), "Initial engine preference saved")
          await extensionPage.evaluate(async engine => {
            const api = globalThis.browser ?? chrome
            const key = "orateur:reader-prefs"
            const prefs = (await api.storage.local.get(key))[key]
            await api.storage.local.set({ [key]: { ...prefs, engine } })
          }, engine)
        }
        if (!telemetry) {
          // Settings initialize the default before tests opt out. The rejecting
          // proxy remains the final guard against production analytics traffic.
          await waitFor(() => extensionPage.evaluate(async () => {
            const api = globalThis.browser ?? chrome
            return typeof (await api.storage.local.get("orateur:telemetry"))["orateur:telemetry"]?.enabled === "boolean"
          }), "Initial statistics preference saved")
          await extensionPage.evaluate(async () => {
            await (globalThis.browser ?? chrome).storage.local.set({ "orateur:telemetry": { enabled: false, distinctId: null } })
          })
        }
      },
      async reloadOptions() {
        if (browserName === "chrome") return extensionPage.reload()
        const marker = randomUUID()
        await extensionPage.evaluate(marker => { globalThis.__orateurReloadMarker = marker }, marker)
        await browser.connection.send("browsingContext.reload", { context: extensionPage.mainFrame()._id, wait: "none" })
        await waitFor(() => extensionPage.evaluate(marker => globalThis.__orateurReloadMarker !== marker && Boolean(document.querySelector("h1")), marker).catch(() => false), "Reloaded extension page is ready")
      },
      async tabId(target = page) {
        return extensionPage.evaluate(async url => {
          const api = globalThis.browser ?? chrome
          const tabs = await api.tabs.query({})
          return tabs.find(tab => tab.url === url)?.id
        }, target.url())
      },
      async script(fn, args = [], target = page) {
        const tabId = await h.tabId(target)
        assert.ok(Number.isInteger(tabId), `No extension tab for ${target.url()}`)
        if (browserName === "chrome") {
          // Create the extension realm on pre-install tabs, without injecting
          // the reader: the production background must still recover it.
          await extensionPage.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => null }), tabId)
          const realm = await waitFor(async () => {
            for (const realm of target.extensionRealms()) if ((await realm.extension())?.id === h.extensionId) return realm
            return null
          }, "Extension content realm available")
          return realm.evaluate(fn, ...args)
        }
        const result = await extensionPage.evaluate(async ({ tabId, source, args }) => {
          return browser.tabs.executeScript(tabId, { code: `(${source})(...${JSON.stringify(args)})` })
        }, { tabId, source: fn.toString(), args })
        return result[0]
      },
      async shadow(host, selector, target = page) {
        return h.script((host, selector) => {
          const element = document.querySelector(host)
          if (!element) return null
          const root = globalThis.chrome?.dom?.openOrClosedShadowRoot(element) ?? element.openOrClosedShadowRoot
          const found = root?.querySelector(selector)
          if (!found) return null
          const rect = found.getBoundingClientRect()
          return { text: found.textContent, disabled: found.disabled, hidden: found.hidden, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }
        }, [host, selector], target)
      },
      async click(label, target = page, host = "orateur-reader-pill") {
        if (!await target.evaluate(() => document.hasFocus())) await target.bringToFront()
        let previous
        const button = await waitFor(async () => {
          const value = await h.shadow(host, `button[aria-label=${JSON.stringify(label)}]`, target)
          const stable = value && previous && ["x", "y", "width", "height"].every(key => Math.abs(value[key] - previous[key]) < 0.25)
          previous = value
          return stable && !value.disabled && !value.hidden && value.width > 0 && value.height > 0 ? value : null
        }, `Visible enabled button: ${label}`)
        await target.mouse.click(button.x, button.y)
      },
      async fakeSpeech(target = page) {
        await h.script(() => {
          const state = globalThis.__orateurSpeech = { spoken: [], paused: false, cancelled: 0 }
          speechSynthesis.speak = utterance => {
            state.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate })
            queueMicrotask(() => utterance.dispatchEvent(new Event("start")))
          }
          speechSynthesis.pause = () => { state.paused = true }
          speechSynthesis.resume = () => { state.paused = false }
          speechSynthesis.cancel = () => { state.cancelled++ }
        }, [], target)
      },
      async speech(target = page) { return h.script(() => globalThis.__orateurSpeech, [], target) },
    }
    try {
      await run(h, t)
      assert.deepEqual(errors.filter(error => !error.url.startsWith("chrome-error:")), [], "Uncaught browser errors")
    } catch (error) {
      const directory = resolve(".output/test-results/e2e", `${browserName}-${t.name.replace(/[^a-z0-9]+/gi, "-")}`)
      await mkdir(directory, { recursive: true })
      for (const [index, p] of (await browser.pages()).entries()) await p.screenshot({ path: join(directory, `${index}.png`), fullPage: true }).catch(() => {})
      await writeFile(join(directory, "diagnostics.json"), JSON.stringify({ archive, sha256: pkg.sha256, browser: await browser.version(), targets: browser.targets().map(target => ({ type: target.type(), url: target.url() })), error: error.stack, logs, errors, blocked }, null, 2))
      throw error
    }
  })
}
