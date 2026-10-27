import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { detectLang } from "./detect-lang.ts"
import { expandText } from "./pronunciation/index.ts"
import { toSupertonicLang } from "./supertonic-lang.ts"

// Exercise the reader's actual playback function without its page UI or a browser.
const source = ts.createSourceFile("reader.content.ts", readFileSync(new URL("../entrypoints/reader.content.ts", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true)
function findPlay(node: ts.Node): ts.FunctionDeclaration | undefined {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "play") return node
  return ts.forEachChild(node, findPlay)
}
const play = findPlay(source)
assert.ok(play, "Reader playback function exists")
const { outputText } = ts.transpileModule(play.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
})

const english = { voiceURI: "english", lang: "en-US" }
const french = { voiceURI: "french", lang: "fr-CA" }
type Voice = typeof english

class Utterance extends EventTarget {
  text: string
  lang = ""
  rate = 1
  voice: Voice | null = null
  constructor(text: string) {
    super()
    this.text = text
  }
}

function read(voiceURI: string | null, blockLangs: (string | undefined)[], lang?: string) {
  const spoken: Utterance[] = []
  vm.runInNewContext(`${outputText}\nplay(0, 0)`, {
    blocks: blockLangs.map(() => "Current page text."), blockLangs, lang,
    prefs: { voiceURI, speed: 1 }, generation: 0, startGeneration: 0,
    pageSource: null,
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      getVoices: () => [english, french],
      speak: (utterance: Utterance) => spoken.push(utterance),
    },
  })
  return spoken
}

test("translated French text does not force a saved English voice", () => {
  const [utterance] = read(english.voiceURI, ["fr"])
  assert.equal(utterance.lang, "fr")
  assert.equal(utterance.voice, null)
})

test("a matching regional voice remains selected", () => {
  assert.equal(read(french.voiceURI, ["fr"])[0].voice, french)
  assert.equal(read(english.voiceURI, ["en-GB"])[0].voice, english)
})

test("unknown text language retains the selected voice", () => {
  for (const lang of [undefined, "na"]) {
    const [utterance] = read(english.voiceURI, [lang])
    assert.equal(utterance.lang, "")
    assert.equal(utterance.voice, english)
  }
})

test("an unavailable saved voice leaves the browser's choice", () => {
  assert.equal(read("removed-voice", ["fr"])[0].voice, null)
})

test("voice compatibility is checked for each paragraph", () => {
  const spoken = read(english.voiceURI, ["en", "fr"])
  assert.equal(spoken[0].voice, english)
  spoken[0].dispatchEvent(new Event("end"))
  assert.equal(spoken[1].lang, "fr")
  assert.equal(spoken[1].voice, null)
})

const FR = "Le chat est assis sur le tapis et regarde la fenêtre avec attention, pendant que la pluie tombe doucement sur les toits de la ville entière."
const EN = "The cat is sitting on the mat and watching the window with attention, while the rain falls gently on the roofs of the whole city outside."

function deferredText() {
  let resolve!: (text: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function liveRead() {
  const pending = deferredText()
  const spoken: Utterance[] = []
  const prepared: [number, boolean][] = []
  const prefetched: number[] = []
  const errors: [string, string][] = []
  let folds = 0
  const context = vm.createContext({
    blocks: [EN, EN], blockLangs: ["en", "en"], lang: "en",
    prefs: { voiceURI: english.voiceURI, speed: 1, follow: true },
    generation: 0, startGeneration: 0, reading: true, paused: false, stale: false,
    blockIndex: 0, charIndex: 0, pageIntro: "", pageRules: [], readingTitle: "Article", readingTotal: 2,
    pageSource: {
      prepare(index: number, follow: boolean, prefetch = false) {
        if (prefetch) prefetched.push(index)
        else prepared.push([index, follow])
        return pending.promise
      },
    },
    persistProgress: () => {},
    follower: { show: () => {} },
    detectLang, expandText, toSupertonicLang,
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      getVoices: () => [english, french],
      speak: (utterance: Utterance) => spoken.push(utterance),
    },
    fold: () => { folds++ },
    pill: { setState: (state: string, title: string) => errors.push([state, title]) },
  })
  vm.runInContext(outputText, context)
  return { pending, context, spoken, prepared, prefetched, errors, folds: () => folds,
    play: (block = 1, from = 0) => vm.runInContext(`play(${block}, ${from})`, context) as Promise<void>,
  }
}

test("native playback waits for live French text and resets an obsolete English offset", async () => {
  const h = liveRead()
  const playback = h.play(1, 17)
  assert.deepEqual(h.prepared, [[1, true]])
  assert.deepEqual(h.spoken, [], "An untranslated snapshot must not enter the speech queue")

  h.pending.resolve(FR)
  await playback
  assert.equal(h.spoken.length, 1)
  assert.equal(h.spoken[0].text, FR)
  assert.equal(h.spoken[0].lang, "fr")
  assert.equal(h.spoken[0].voice, null)
  assert.equal(h.context.blocks[1], FR)
  assert.equal(h.context.blockLangs[1], "fr")
})

test("native playback prepares the next translation while the current paragraph is speaking", async () => {
  const h = liveRead()
  const playback = h.play(0)
  h.pending.resolve(FR)
  await playback
  h.spoken[0].dispatchEvent(new Event("start"))
  assert.deepEqual(h.prefetched, [1])
  assert.equal(h.spoken.length, 1, "Preparation must not queue overlapping speech")
})

test("pausing during live preparation keeps the pending paragraph as the resume target", async () => {
  const h = liveRead()
  const playback = h.play(1, 11)
  h.context.paused = true
  h.pending.resolve(FR)
  await playback

  assert.deepEqual(h.spoken, [])
  assert.equal(h.context.stale, true)
  assert.equal(h.context.blockIndex, 1)
  assert.equal(h.context.charIndex, 11)
  assert.equal(h.folds(), 0)

  h.context.paused = false
  await h.play(h.context.blockIndex, h.context.charIndex)
  assert.equal(h.spoken.length, 1)
  assert.equal(h.spoken[0].text, FR, "Resuming uses the prepared paragraph without the old English offset")
  assert.equal(h.spoken[0].lang, "fr")
})

test("invalidated playback cannot queue delayed live text", async () => {
  for (const invalidated of ["generation", "startGeneration", "pageSource", "reading"] as const) {
    const h = liveRead()
    const playback = h.play()
    if (invalidated === "pageSource") h.context.pageSource = null
    else if (invalidated === "reading") h.context.reading = false
    else h.context[invalidated]++
    h.pending.resolve(FR)
    await playback

    assert.deepEqual(h.spoken, [], invalidated)
    assert.equal(h.folds(), 0, invalidated)
    assert.deepEqual(h.errors, [], invalidated)
  }
})

test("failed live preparation reports an error instead of reading the English snapshot", async () => {
  const h = liveRead()
  const playback = h.play()
  h.pending.reject(new Error("Translation source unavailable"))
  await playback

  assert.deepEqual(h.spoken, [])
  assert.equal(h.folds(), 1)
  assert.deepEqual(h.errors, [["error", "Article"]])
})

test("a preparation failure from an invalidated session cannot fold the current reader", async () => {
  const h = liveRead()
  const playback = h.play()
  h.context.startGeneration++
  h.pending.reject(new Error("Reading stopped"))
  await playback

  assert.deepEqual(h.spoken, [])
  assert.equal(h.folds(), 0)
  assert.deepEqual(h.errors, [])
})
