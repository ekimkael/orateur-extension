import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

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
    prefs: { voiceURI, speed: 1 }, generation: 0,
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
