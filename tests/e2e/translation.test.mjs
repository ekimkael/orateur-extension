import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { browserTest, waitFor } from "../support/browser.mjs"

browserTest("reads translated text with its detected language instead of a saved foreign voice", async h => {
  await h.install()
  const french = "Orateur permet de lire un article sans quitter sa page. Ce paragraphe contient suffisamment de texte pour vérifier que la lecture utilise bien le français, même lorsque le site déclare encore une langue anglaise."
  const english = "The reader lets you listen to an article without leaving the page. This paragraph contains enough text to verify that the reading uses the English voice selected by the user and keeps that preference for the next article."
  const digest = readFileSync(new URL("../fixtures/english-digest.txt", import.meta.url), "utf8").trim().replace(/\s+/g, " ")

  for (const scenario of [
    { text: french, selected: "english", lang: "fr", voice: null },
    { text: french, selected: "french", lang: "fr", voice: "french" },
    { text: english, selected: "english", lang: "en", voice: "english" },
    { text: digest, excerpt: "Teams can publish their development tools through a single release workflow.", selected: "french", lang: "en", voice: null, declared: "fr-FR" },
  ]) {
    await h.options.evaluate(async voiceURI => {
      const api = globalThis.browser ?? chrome
      await api.storage.local.set({ "orateur:reader-prefs": { engine: "system", voiceURI, follow: false } })
      await api.storage.local.remove("orateur:reading-progress")
    }, scenario.selected)
    await h.page.reload()
    await h.page.waitForSelector("orateur-reader-pill")
    await h.page.evaluate(({ text, lang, declared }) => {
      document.documentElement.lang = declared ?? "en-US"
      document.documentElement.classList.toggle("translated-ltr", lang === "fr")
      document.title = "An article originally written in English"
      document.querySelector("h1").textContent = document.title
      // Google translation replaces text with nested font elements; metadata
      // and the document's original language can still describe the source.
      for (const paragraph of document.querySelectorAll("article p")) {
        const outer = document.createElement("font"), inner = document.createElement("font")
        outer.style.verticalAlign = inner.style.verticalAlign = "inherit"
        inner.textContent = text
        outer.append(inner)
        paragraph.replaceChildren(outer)
      }
    }, scenario)
    await h.script(() => {
      globalThis.__translatedSpeech = []
      globalThis.SpeechSynthesisUtterance = class extends EventTarget {
        constructor(text) {
          super()
          this.text = text
          this.lang = ""
          this.voice = null
        }
      }
      speechSynthesis.getVoices = () => [
        { voiceURI: "english", name: "English", lang: "en-US" },
        { voiceURI: "french", name: "French", lang: "fr-CA" },
      ]
      speechSynthesis.cancel = () => {}
      speechSynthesis.speak = utterance => {
        globalThis.__translatedSpeech.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.voiceURI ?? null })
        queueMicrotask(() => utterance.dispatchEvent(new Event("start")))
      }
    })
    await h.click("Read this page with Orateur")
    const spoken = await waitFor(() => h.script(() => globalThis.__translatedSpeech[0]), "Translated article reaches speech engine")
    assert.ok(spoken.text.includes(scenario.excerpt ?? scenario.text), `Reads the current DOM text: ${JSON.stringify(spoken)}`)
    // Live paragraph detection resolves the language; the selected voice keeps its region.
    assert.equal(new Intl.Locale(spoken.lang).language, scenario.lang, "Speech language follows the current text")
    assert.equal(spoken.voice, scenario.voice, "Saved voice applies only to a matching language")
    const saved = await h.options.evaluate(async () => (await (globalThis.browser ?? chrome).storage.local.get("orateur:reader-prefs"))["orateur:reader-prefs"].voiceURI)
    assert.equal(saved, scenario.selected, "Reading another language preserves the saved voice")
    await h.click("Stop reading")
  }
})
