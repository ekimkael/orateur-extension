import assert from "node:assert/strict"
import test from "node:test"
import { createPocketTtsHost } from "./pocket-tts-host.ts"
import type { TtsState } from "./tts-messages.ts"

const sample = { pcm: new Float32Array([0, 0.25, -0.25]), sampleRate: 24_000 }
const settle = () => new Promise((resolve) => setImmediate(resolve))
const request = { text: "API at 14:05.\n\nA second paragraph.", lang: "en", voice: "auto", speed: 1 }

function setup() {
  const media: FakeAudio[] = []
  class FakeAudio {
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    playbackRate = 1
    paused = true
    constructor() { media.push(this) }
    async play() { this.paused = false }
    pause() { this.paused = true }
    removeAttribute() {}
  }
  Object.assign(globalThis, { Audio: FakeAudio })
  const states: TtsState[] = []
  const jobs: { text: string; signal: AbortSignal; result: PromiseWithResolvers<typeof sample> }[] = []
  const host = createPocketTtsHost((state) => states.push(state), {
    synthesize(text, _voice, _lang, { signal }) {
      const result = Promise.withResolvers<typeof sample>()
      jobs.push({ text, signal, result })
      return result.promise
    },
    dispose() {},
  })
  return { host, states, jobs, media }
}

test("Pocket prefetches unprepared text and keeps a seek paused until resumed", async () => {
  const { host, states, jobs, media } = setup()
  host.speak(request)
  await settle()
  assert.equal(jobs[0]?.text, "API at 14:05.")
  jobs[0]!.result.resolve(sample)
  await settle()
  assert.deepEqual(states.at(-1), { phase: "playing", block: 0, total: 2 })
  assert.equal(jobs[1]?.text, "A second paragraph.", "static text can be prefetched")
  host.seek(1, true)
  await settle()
  assert.equal(media[0]?.paused, true)
  assert.equal(jobs[1]?.signal.aborted, true)
  jobs[1]!.result.resolve(sample)
  jobs[2]!.result.resolve(sample)
  await settle()
  assert.equal(media.length, 2, "the cancelled prefetch never starts audio")
  assert.equal(media[1]?.paused, true)
  host.setSpeed(1.25)
  host.control("resume")
  await settle()
  assert.equal(media[1]?.playbackRate, 1.25)
  assert.deepEqual(states.at(-1), { phase: "playing", block: 1, total: 2 })
  media[1]!.onended?.()
  await settle()
  assert.deepEqual(states.at(-1), { phase: "ended" })
  host.dispose?.()
})

test("Pocket prefetches a live paragraph passively and promotes it at the transition", async () => {
  const { host, states, jobs, media } = setup()
  const prepared: [number, boolean | undefined][] = []
  const second = Promise.withResolvers<{ text: string; lang: string }>()
  host.speak({ ...request, prepareParagraph(block, prefetch) {
    prepared.push([block, prefetch])
    return block === 0 ? Promise.resolve({ text: "Texte traduit.", lang: "fr" }) : second.promise
  } })
  await settle()
  assert.equal(jobs[0]?.text, "Texte traduit.")
  jobs[0]!.result.resolve(sample)
  await settle()
  assert.deepEqual(prepared, [[0, false], [1, true]], "lookahead must not reveal the next paragraph")
  media[0]!.onended?.()
  await settle()
  assert.deepEqual(prepared, [[0, false], [1, true], [1, false]], "the transition promotes the pending wait")
  assert.deepEqual(states.at(-1), { phase: "loading", reason: "preparing-next" })
  second.resolve({ text: "La suite.", lang: "fr" })
  await settle()
  assert.equal(jobs[1]?.text, "La suite.")
  host.control("stop")
  jobs[1]!.result.resolve(sample)
  await settle()
  assert.equal(media.length, 1, "a result arriving after stop cannot start audio")
  assert.equal(states.some((state) => state.phase === "playing" && state.block === 1), false)
})

test("Pocket chains live paragraphs without a gap once lookahead is ready", async () => {
  const { host, states, jobs, media } = setup()
  host.speak({ ...request, async prepareParagraph(block) {
    return { text: block === 0 ? "First." : "Second.", lang: "en" }
  } })
  await settle()
  jobs[0]!.result.resolve(sample)
  await settle()
  assert.equal(jobs[1]?.text, "Second.", "the next paragraph renders while the first one plays")
  jobs[1]!.result.resolve(sample)
  await settle()
  media[0]!.onended?.()
  await settle()
  assert.equal(media.length, 2)
  assert.equal(states.some((state) => state.phase === "loading" && state.reason === "preparing-next"), false)
  assert.deepEqual(states.at(-1), { phase: "playing", block: 1, total: 2 })
  host.dispose?.()
})

test("Pocket keeps several units ahead so a short heading does not leave a gap", async () => {
  const { host, jobs, media } = setup()
  host.speak({ ...request, text: "Title.\n\nA long paragraph.\n\nThe third one." })
  await settle()
  jobs[0]!.result.resolve(sample)
  await settle()
  assert.deepEqual(jobs.map((job) => job.text), ["Title.", "A long paragraph.", "The third one."],
    "the units after a short heading render while it plays")
  assert.equal(media[0]?.paused, false)
  host.dispose?.()
})

test("Pocket ramps unit sizes up after a start so the first sound arrives quickly", async () => {
  const { host, jobs } = setup()
  const text = "La lecture à voix haute transforme un long article en un moment d'écoute, que l'on suit en marchant. " +
    "Chaque paragraphe est découpé en morceaux courts, synthétisés pendant que le précédent est joué. " +
    "Si la synthèse prend plus de temps que la lecture du morceau précédent, on entend un silence entre les deux. " +
    "Ce test vérifie donc la taille des premiers morceaux."
  host.speak({ ...request, text, lang: "fr" })
  await settle()
  for (let i = 0; i < 6 && jobs[i]; i++) {
    jobs[i]!.result.resolve(sample)
    await settle()
  }
  const sizes = jobs.map((job) => job.text.length)
  assert.ok(sizes[0]! <= 80, `first unit: ${sizes[0]}`)
  assert.ok(sizes[1]! <= 140, `second unit: ${sizes[1]}`)
  assert.ok(sizes.every((size) => size <= 180))
  assert.equal(jobs[0]!.text, "La lecture à voix haute transforme un long article en un moment d'écoute,", "a long first sentence is cut at a clause")
  assert.equal(jobs.map((job) => job.text).join(" "), text, "no text is lost")
  host.dispose?.()
})

test("Pocket adds a pause after sentence and paragraph ends, none after a clause cut or the last unit", async (t) => {
  const { host, jobs, media } = setup()
  const samples: number[] = []
  const createObjectURL = URL.createObjectURL
  t.mock.method(URL, "createObjectURL", (blob: Blob) => {
    samples.push((blob.size - 44) / 2)
    return createObjectURL(blob)
  })
  host.speak({ ...request, lang: "fr", text: "Le soleil se lève doucement sur la ville encore endormie ce matin. " +
    "Les rues sont calmes et les cafés ouvrent leurs portes un à un.\n\n" +
    "Nous partons tôt pour éviter la foule et la chaleur de midi qui arrive, " +
    "puis nous rentrons tranquillement à la maison avant le déjeuner prévu." })
  await settle()
  for (let i = 0; i < 4; i++) {
    jobs[i]!.result.resolve(sample)
    await settle()
    media[i]!.onended?.()
    await settle()
  }
  assert.deepEqual(jobs.map((job) => job.text.at(-1)), [".", ".", ",", "."])
  assert.deepEqual(samples, [3 + 0.6 * 24_000, 3 + 24_000, 3, 3], "the reading ends with its last word")
  host.dispose?.()
})

test("Pocket keeps the unit after a short opening heading short", async () => {
  const { host, jobs } = setup()
  host.speak({ ...request, text: "Introduction.\n\nThis paragraph is long enough to need several units, because it keeps going " +
    "with more words, more clauses and more details than a single short unit could ever hold at once." })
  await settle()
  jobs[0]!.result.resolve(sample)
  await settle()
  assert.equal(jobs[0]!.text, "Introduction.")
  assert.ok(jobs[1]!.text.length <= 80, `the unit after the heading renders in less time than the heading plays: ${jobs[1]!.text.length}`)
  host.dispose?.()
})

test("Pocket does not re-request a live paragraph that is already prepared", async () => {
  const { host, jobs, media } = setup()
  const prepared: [number, boolean | undefined][] = []
  host.speak({ ...request, async prepareParagraph(block, prefetch) {
    prepared.push([block, prefetch])
    return { text: block === 0 ? "First." : "Second.", lang: "en" }
  } })
  await settle()
  jobs[0]!.result.resolve(sample)
  await settle()
  media[0]!.onended?.()
  await settle()
  assert.equal(jobs[1]?.text, "Second.", "only synthesis is still pending")
  assert.deepEqual(prepared, [[0, false], [1, true]])
  host.dispose?.()
})

test("Pocket reports why synthesis failed, so a download error can be classified", async () => {
  const { host, states, jobs } = setup()
  host.speak(request)
  await settle()
  jobs[0]!.result.reject(new Error("Pocket model download failed (HTTP 503)"))
  await settle()
  assert.deepEqual(states.at(-1), { phase: "error", message: "Pocket model download failed (HTTP 503)", reason: undefined })
})
