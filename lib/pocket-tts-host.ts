import type { LocalTtsHost, PocketSpeakRequest } from "./local-tts-host.ts"
import { isPocketVoice, toPocketLanguage, type PocketLanguage } from "./pocket/catalog.ts"
import { createPocketRuntime } from "./pocket/runtime.ts"
import { splitBlocks } from "./reading-language.ts"
import { chunkText, writeWavFile } from "./supertonic/engine.ts"
import type { TtsPreparedBlock, TtsState } from "./tts-messages.ts"

class AudioPlaybackError extends Error {}

const LOOKAHEAD = 3
const MAX_UNIT = 180
// After a start or seek the first sound waits for one short unit. Pocket renders
// ~1.75x faster than real time in Chrome and Firefox, so until units reach
// MAX_UNIT each one may be at most ~1.75x longer than the one playing before it.
const FIRST_UNIT = 80
const GROWTH = 1.75

/** Split text into sentence groups of at most `max` characters, cutting long sentences at a clause, else between words. */
function pieces(text: string, max: number): string[] {
  const cut = new RegExp(`.{1,${max - 1}}[,;:](?=\\s)|.{1,${max}}(?:\\s+|$)|.{1,${max}}`, "gsu")
  return chunkText(text, max)
    .flatMap((piece) => piece.length > max ? piece.match(cut) ?? [] : [piece])
    .map((piece) => piece.trim()).filter(Boolean)
}

// Pocket pauses 0.6-0.8 s between sentences inside a unit but trails only
// 0.06-0.34 s at its end (measured in Chrome), so joins between units sound rushed.
const SENTENCE_PAUSE = 0.6
const PARAGRAPH_PAUSE = 1

/** Append the silence a unit's ending calls for; a clause or word cut keeps the flow. */
function withPause(pcm: Float32Array, sampleRate: number, unit: { text: string; lastInBlock: boolean }, final: boolean): Float32Array {
  const seconds = final ? 0 : unit.lastInBlock ? PARAGRAPH_PAUSE : /[.!?…]["'»”’)\]]*$/u.test(unit.text) ? SENTENCE_PAUSE : 0
  if (!seconds) return pcm
  const padded = new Float32Array(pcm.length + Math.round(seconds * sampleRate))
  padded.set(pcm)
  return padded
}

/** Plays bounded Pocket units with a few units of lookahead and no pronunciation preparation. */
export function createPocketTtsHost(
  onState: (state: TtsState) => void,
  runtime = createPocketRuntime(),
): LocalTtsHost<PocketSpeakRequest> {
  let reading: { request: PocketSpeakRequest; blocks: string[] } | null = null
  let work: AbortController | null = null
  let clip: { audio: HTMLAudioElement; play(): void; pause(): void } | null = null
  let paused = false
  let speed = 1

  // `next(true)` marks the pull as lookahead: the live page then prepares the
  // paragraph passively, without scrolling or turning an untranslated snapshot into audio.
  // `live.preparing` names the block whose live text is still awaited.
  async function* units(
    request: PocketSpeakRequest, blocks: string[], start: number, signal: AbortSignal, live: { preparing: number | null },
  ): AsyncGenerator<{ text: string; block: number; lang: PocketLanguage; lastInBlock: boolean }, void, boolean | undefined> {
    let prefetch = false
    let limit = FIRST_UNIT
    for (let block = start; block < blocks.length; block++) {
      signal.throwIfAborted()
      live.preparing = request.prepareParagraph ? block : null
      const prepared: TtsPreparedBlock<string> | null | undefined = await request.prepareParagraph?.(block, prefetch)
        .finally(() => { live.preparing = null })
      signal.throwIfAborted()
      if (prepared === null) throw new Error("Live paragraph unavailable")
      const lang = toPocketLanguage(prepared?.lang ?? request.lang)
      if (!lang) throw new Error("Unsupported Pocket language")
      let rest: string = prepared?.text ?? blocks[block]!
      while (rest) {
        const [text, ...others] = pieces(rest, limit)
        if (!text) break
        rest = others.join(" ")
        // Once units reach full size the lookahead keeps them ahead; a later short heading must not shrink them.
        if (limit < MAX_UNIT) limit = Math.min(MAX_UNIT, Math.max(FIRST_UNIT, Math.floor(text.length * GROWTH)))
        prefetch = (yield { text, block, lang, lastInBlock: !rest }) === true
      }
    }
  }

  function playClip(pcm: Float32Array, sampleRate: number, block: number, total: number, signal: AbortSignal) {
    const url = URL.createObjectURL(new Blob([writeWavFile(pcm, sampleRate)], { type: "audio/wav" }))
    const audio = new Audio(url)
    audio.playbackRate = speed
    return new Promise<void>((resolve, reject) => {
      let attempt = 0
      const finish = (error?: unknown) => {
        signal.removeEventListener("abort", abort)
        audio.onended = null
        audio.onerror = null
        audio.pause()
        audio.removeAttribute("src")
        URL.revokeObjectURL(url)
        if (clip?.audio === audio) clip = null
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(signal.reason)
      audio.onended = () => finish()
      audio.onerror = () => finish(new AudioPlaybackError())
      signal.addEventListener("abort", abort, { once: true })
      clip = {
        audio,
        play() {
          const mine = ++attempt
          void audio.play().then(() => {
            if (clip?.audio === audio && mine === attempt && !paused) onState({ phase: "playing", block, total })
          }).catch(() => {
            if (clip?.audio === audio && mine === attempt && !paused) finish(new AudioPlaybackError())
          })
        },
        pause() {
          attempt++
          audio.pause()
        },
      }
      if (!paused) clip.play()
    })
  }

  async function run({ request, blocks }: NonNullable<typeof reading>, start: number, signal: AbortSignal) {
    const voice = request.voice
    if (!isPocketVoice(voice)) throw new Error("Unsupported Pocket voice")
    const live = { preparing: null as number | null }
    const queue = units(request, blocks, start, signal, live)
    let waiting = true
    const render = async (prefetch: boolean) => {
      const { value, done } = await queue.next(prefetch)
      signal.throwIfAborted()
      if (done) return null
      const sample = await runtime.synthesize(value.text, voice, value.lang, {
        signal,
        cacheOnly: request.cacheOnly,
        onProgress: (state) => {
          if (waiting && !paused && !signal.aborted) {
            onState(state.phase === "downloading-model"
              ? { phase: "loading", reason: state.phase, progress: state.progress }
              : { phase: "loading", reason: state.phase })
          }
        },
      })
      const final = value.lastInBlock && value.block === blocks.length - 1
      return { ...value, pcm: withPause(sample.pcm, sample.sampleRate, value, final), sampleRate: sample.sampleRate }
    }
    // Units ahead of playback, in reading order. The runtime serializes synthesis,
    // so a deeper queue only buys slack: a short heading plays for ~1 s while
    // the next 180-character unit takes ~3 s to render (RTF ~0.6 in Chrome and Firefox).
    const ahead: { result: Promise<{ value: Awaited<ReturnType<typeof render>> } | { error: unknown }>; ready: boolean }[] = []
    try {
      let current = await render(false)
      while (current) {
        signal.throwIfAborted()
        waiting = false
        const playback = playClip(current.pcm, current.sampleRate, current.block, blocks.length, signal)
        const last = current.lastInBlock && current.block === blocks.length - 1
        while (!last && ahead.length < LOOKAHEAD) {
          const entry: typeof ahead[number] = {
            ready: false,
            result: render(true).then((value) => ({ value }), (error: unknown) => ({ error })),
          }
          void entry.result.then(() => { entry.ready = true })
          ahead.push(entry)
        }
        await playback
        signal.throwIfAborted()
        if (last) break
        const next = ahead.shift()!
        waiting = true
        if (!next.ready) {
          if (!paused) onState({ phase: "loading", reason: "preparing-next" })
          // The listener now needs this paragraph: upgrade the passive wait so a
          // translated page reveals it, as the Supertonic host does.
          if (live.preparing === current.block + 1) void request.prepareParagraph?.(current.block + 1, false)?.catch(() => {})
        }
        const result = await next.result
        if ("error" in result) throw result.error
        current = result.value
      }
      if (!signal.aborted) onState({ phase: "ended" })
    } finally {
      void queue.return(undefined)
    }
  }

  function jump(block: number, stayPaused: boolean) {
    if (!reading || block < 0 || block >= reading.blocks.length) return
    work?.abort()
    const controller = new AbortController()
    work = controller
    paused = stayPaused
    if (!paused) onState({ phase: "loading", reason: "loading-engine" })
    void run(reading, block, controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return
      controller.abort()
      onState({ phase: "error", message: "Pocket playback failed", reason: error instanceof AudioPlaybackError ? "audio-playback" : undefined })
    })
  }

  function stop() {
    work?.abort()
    work = null
    reading = null
    paused = false
  }

  return {
    speak(request) {
      stop()
      reading = { request, blocks: splitBlocks(request.text) }
      speed = request.speed
      const start = request.startBlock ?? 0
      if (start >= reading.blocks.length) onState({ phase: "ended" })
      else jump(start, false)
    },
    control(action) {
      if (action === "stop") return stop()
      paused = action === "pause"
      if (paused) {
        clip?.pause()
        onState({ phase: "paused" })
      } else if (clip) clip.play()
      else onState({ phase: "loading", reason: "preparing-next" })
    },
    seek: jump,
    setSpeed(value) {
      speed = value
      if (clip) clip.audio.playbackRate = value
    },
    dispose() {
      stop()
      runtime.dispose()
    },
  }
}
