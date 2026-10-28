import type { TtsState } from "./tts-messages.ts"
import { detectLang } from "./detect-lang.ts"
import { toSupertonicLang } from "./supertonic-lang.ts"
import { resolveBlockLangs } from "./reading-language.ts"
import { expandText } from "./pronunciation/index.ts"
import type { PronunciationRule } from "./pronunciation/personal.ts"

/** Never let the browser choose a potentially remote default voice for a PDF. */
export function localPdfVoices(voices: readonly SpeechSynthesisVoice[]) {
  return voices.filter((voice) => voice.localService === true)
}

export function choosePdfVoice(voices: readonly SpeechSynthesisVoice[], voiceURI: string | null, lang: string) {
  const local = localPdfVoices(voices)
  return local.find((voice) => voice.voiceURI === voiceURI)
    ?? local.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase())
    ?? local.find((voice) => voice.lang.split("-")[0]!.toLowerCase() === lang.split("-")[0]!.toLowerCase())
    ?? local[0]
}

interface SpeechUnit { text: string; block: number; lang?: string }

/** Short utterances avoid Chromium's long-utterance timeout, including unbroken text. */
export function pdfSpeechUnits(paragraphs: readonly string[]): SpeechUnit[] {
  return paragraphs.flatMap((paragraph, block) => {
    const units: SpeechUnit[] = []
    let remaining = paragraph.trim()
    while (remaining) {
      let end = Math.min(remaining.length, 180)
      if (end < remaining.length) {
        const boundary = remaining.slice(0, end).search(/[.!?。！？]\s+[^.!?。！？]*$/u)
        const space = remaining.lastIndexOf(" ", end)
        if (boundary >= 40) end = boundary + 1
        else if (space >= 40) end = space
        // Don't divide a UTF-16 surrogate pair on a hard break.
        else if (/[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--
      }
      units.push({ text: remaining.slice(0, end), block })
      remaining = remaining.slice(end).trimStart()
    }
    return units
  })
}

export interface PdfSpeechRequest {
  paragraphs: string[]
  voiceURI: string | null
  lang: string
  speed: number
  personalRules?: readonly PronunciationRule[]
}

export function createPdfSystemPlayer(
  onState: (state: TtsState) => void,
  synthesis: SpeechSynthesis = speechSynthesis,
  Utterance: typeof SpeechSynthesisUtterance = SpeechSynthesisUtterance,
) {
  let generation = 0
  let request: PdfSpeechRequest | null = null
  let units: SpeechUnit[] = []
  let index = 0
  let offset = 0
  let paused = false
  let needsRestart = false
  let active = false

  function cancel() {
    synthesis.resume()
    synthesis.cancel()
  }

  function stop(cancelAudio = true) {
    generation++
    if (active && cancelAudio) cancel()
    active = false
    paused = false
    request = null
    units = []
  }

  function play() {
    if (!request || !active || paused) return
    const unit = units[index]
    if (!unit) {
      stop(false)
      onState({ phase: "ended" })
      return
    }
    const voice = choosePdfVoice(synthesis.getVoices(), request.voiceURI, unit.lang ?? request.lang)
    if (!voice) {
      stop()
      onState({ phase: "error", message: "no-local-voice" })
      return
    }
    const mine = ++generation
    const from = offset
    const utterance = new Utterance(unit.text.slice(from))
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.rate = request.speed
    utterance.addEventListener("start", () => {
      if (generation === mine && !paused && request) onState({ phase: "playing", block: unit.block, total: request.paragraphs.length })
    })
    utterance.addEventListener("boundary", (event) => {
      if (generation === mine) offset = from + event.charIndex
    })
    utterance.addEventListener("end", () => {
      if (generation !== mine) return
      index++
      offset = 0
      needsRestart = paused
      play()
    })
    utterance.addEventListener("error", () => {
      if (generation !== mine) return
      stop()
      onState({ phase: "error", message: "speech" })
    })
    try { synthesis.speak(utterance) }
    catch {
      stop()
      onState({ phase: "error", message: "speech" })
    }
  }

  return {
    speak(next: PdfSpeechRequest) {
      stop()
      request = next
      const docLang = detectLang(next.paragraphs.join("\n\n"), toSupertonicLang(next.lang) ?? "na") ?? "na"
      const langs = resolveBlockLangs(next.paragraphs, docLang)
      const spoken = next.paragraphs.map((paragraph, block) => expandText(paragraph, {
        language: langs[block], personalRules: next.personalRules,
      }))
      units = pdfSpeechUnits(spoken).map((unit) => ({ ...unit, lang: langs[unit.block] }))
      index = 0
      offset = 0
      needsRestart = false
      active = true
      onState({ phase: "loading" })
      play()
    },
    control(action: "pause" | "resume" | "stop") {
      if (action === "stop") return stop()
      if (!active || !request) return
      paused = action === "pause"
      if (paused) {
        synthesis.pause()
        onState({ phase: "paused" })
      } else if (needsRestart) {
        needsRestart = false
        play()
      } else {
        synthesis.resume()
        onState({ phase: "playing", block: units[index]?.block ?? 0, total: request.paragraphs.length })
      }
    },
    setSpeed(speed: number) {
      if (!request || !active) return
      request.speed = speed
      generation++
      cancel()
      needsRestart = paused
      play()
    },
    stop,
  }
}
