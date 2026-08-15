/**
 * Le banc de l'ordonnanceur : cache, avance, éviction, arrêt.
 *
 * Ni DOM ni ONNX — `Audio`, `URL.createObjectURL` et le moteur sont remplacés
 * par des doubles minimaux. C'est la seule façon d'observer l'ordonnancement
 * (qui synthétise quoi, quand, et ce qui est révoqué) sans charger 398 Mo de
 * modèle ; jsdom n'implémente de toute façon pas `HTMLMediaElement.play()`.
 */
import assert from "node:assert/strict"
import test, { beforeEach, mock } from "node:test"
// Import statique, donc évalué AVANT le `mock.module` du corps : capture le
// vrai `chunkText`, que le double doit continuer d'exposer tel quel.
import { chunkText } from "./supertonic/engine.ts"

class FakeAudio {
  src = ""
  playbackRate = 1
  preservesPitch = false
  ended = false
  paused = true
  private listeners = new Map<string, Set<() => void>>()
  constructor() {
    audios.push(this)
  }
  addEventListener(type: string, fn: () => void) {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    set.add(fn)
  }
  removeAttribute() {
    this.src = ""
  }
  play() {
    this.paused = false
    this.ended = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  /** Aide de test : termine la lecture en cours comme le ferait le navigateur. */
  finish() {
    this.ended = true
    this.paused = true
    for (const fn of this.listeners.get("ended") ?? []) fn()
  }
}

let audios: FakeAudio[] = []
let synthesized: string[] = []
let created: string[] = []
let revoked: string[] = []
let urlCount = 0

const g = globalThis as unknown as Record<string, unknown>
g.Audio = FakeAudio
URL.createObjectURL = () => {
  const url = `blob:${++urlCount}`
  created.push(url)
  return url
}
URL.revokeObjectURL = (url: string) => {
  revoked.push(url)
}

mock.module(new URL("./supertonic/model-cache.ts", import.meta.url).href, {
  namedExports: { loadModelFiles: async () => () => new ArrayBuffer(0) },
})
mock.module(new URL("./supertonic/engine.ts", import.meta.url).href, {
  namedExports: {
    chunkText,
    loadVoiceStyle: async () => ({}),
    writeWavFile: () => new ArrayBuffer(8),
    loadTextToSpeechEngine: async () => ({
      sampleRate: 44100,
      synthesize: async (text: string) => {
        synthesized.push(text)
        await new Promise((r) => setTimeout(r, 0))
        return new Float32Array(4)
      },
    }),
  },
})

const { createTtsHost } = await import("./tts-host.ts")

/** Laisse tourner les synthèses en vol et les `setTimeout(0)` de `pump()`. */
async function settle(turns = 120) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Un texte de `n` paragraphes courts, donc `n` unités. */
function article(n: number) {
  return Array.from({ length: n }, (_, i) => `Paragraphe ${i}.`).join("\n\n")
}

function start(n: number) {
  const states: string[] = []
  const host = createTtsHost((s) => states.push(s.phase))
  host.speak({ text: article(n), lang: "fr", voice: "F1", speed: 1 })
  return { host, states }
}

/** Les synthèses de contenu, sans l'échauffement « Bonjour. » du chargement moteur. */
function contentSynths() {
  return synthesized.filter((t) => t !== "Bonjour.")
}

beforeEach(() => {
  audios = []
  synthesized = []
  created = []
  revoked = []
})

test("l'avance précharge LOOKAHEAD unités devant la lecture, pas plus", async () => {
  start(20)
  await settle()
  // Unité en cours + 6 d'avance.
  assert.deepEqual(
    contentSynths(),
    Array.from({ length: 7 }, (_, i) => `Paragraphe ${i}.`)
  )
})

test("une unité déjà en cache est jouée sans repasser par le moteur", async () => {
  const { host } = start(20)
  await settle()
  const before = contentSynths().length
  const playing = audios.find((a) => !a.paused)!
  playing.finish()
  await settle()
  // L'unité 1 était en cache : aucune synthèse pour elle, seulement la
  // nouvelle unité de bout d'avance (7).
  assert.deepEqual(contentSynths().slice(before), ["Paragraphe 7."])
  assert.equal(contentSynths().filter((t) => t === "Paragraphe 1.").length, 1)
  host.control("stop")
})

test("la pause ne jette rien du cache", async () => {
  const { host } = start(20)
  await settle()
  const revokedBefore = revoked.length
  host.control("pause")
  host.control("resume")
  await settle()
  assert.equal(revoked.length, revokedBefore)
})

test("stop révoque toutes les URL en cache", async () => {
  const { host } = start(20)
  await settle()
  assert.ok(created.length >= 7)
  host.control("stop")
  assert.deepEqual(new Set(revoked), new Set(created))
})

test("l'éviction ne révoque que des unités déjà lues", async () => {
  const { host } = start(20)
  await settle()
  // Avance de plusieurs unités pour dépasser le plafond du cache.
  for (let i = 0; i < 6; i++) {
    audios.find((a) => !a.paused)!.finish()
    await settle()
  }
  assert.ok(revoked.length > 0, "aucune éviction alors que le plafond est dépassé")
  // Les URL révoquées sont les plus anciennes créées, jamais les dernières.
  const lastCreated = created.slice(-3)
  for (const url of lastCreated) assert.ok(!revoked.includes(url), `${url} évincée trop tôt`)
  host.control("stop")
})

test("une nouvelle lecture ne réutilise pas le cache de la précédente", async () => {
  const { host } = start(4)
  await settle()
  const revokedBefore = revoked.length
  host.speak({ text: article(4), lang: "fr", voice: "F1", speed: 1 })
  await settle()
  assert.ok(revoked.length > revokedBefore, "le cache de la lecture précédente survit")
  assert.equal(contentSynths().filter((t) => t === "Paragraphe 0.").length, 2)
  host.control("stop")
})
