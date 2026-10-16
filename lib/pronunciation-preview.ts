import type { ReaderPreferences } from "./reader-prefs.ts"
import { expandText } from "./pronunciation/index.ts"
import { validatePronunciationRule, type PronunciationRule } from "./pronunciation/personal.ts"
import type { TtsHost } from "./tts-host.ts"
import type { TtsState } from "./tts-messages.ts"

const READER_TOKEN = "orateur:reading-tab"

/** One preview owns the same reading token as page readers. */
export function createPronunciationPreview(onState: (state: TtsState) => void) {
  const previewToken = crypto.randomUUID()
  let generation = 0
  let token: string | null = null
  let host: TtsHost | null = null
  let neuralGeneration: number | null = null
  let nativeOwned = false

  const loseOwnership = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && token && READER_TOKEN in changes && changes[READER_TOKEN]?.newValue !== token) {
      // The new owner cancels the native queue; cancelling here could stop it.
      nativeOwned = false
      stop()
      onState({ phase: "ended" })
    }
  }

  function release() {
    browser.storage.onChanged.removeListener(loseOwnership)
    token = null
    neuralGeneration = null
    nativeOwned = false
  }

  function stop() {
    generation++
    host?.control("stop")
    if (nativeOwned) {
      speechSynthesis.resume()
      speechSynthesis.cancel()
    }
    release()
  }

  function receive(state: TtsState) {
    if (neuralGeneration !== generation || !token) return
    if (state.phase === "ended" || state.phase === "error") release()
    onState(state)
  }

  async function speak(input: PronunciationRule, prefs: ReaderPreferences) {
    stop()
    const mine = generation
    const validation = validatePronunciationRule(input)
    if (!validation.ok) {
      onState({ phase: "error", message: "invalid-rule" })
      return
    }
    const rule = validation.rule
    onState({ phase: "loading" })
    try {
      if (prefs.engine === "supertonic") {
        const { isModelCached } = await import("./supertonic/model-cache.ts")
        if (!await isModelCached()) {
          if (mine === generation) onState({ phase: "error", message: "model-unavailable" })
          return
        }
      }
      if (mine !== generation) return
      token = previewToken
      browser.storage.onChanged.addListener(loseOwnership)
      await browser.storage.local.set({ [READER_TOKEN]: token })
      const owner = await browser.storage.local.get(READER_TOKEN)
      if (mine !== generation) return
      if (owner[READER_TOKEN] !== token) {
        stop()
        onState({ phase: "ended" })
        return
      }
      speechSynthesis.resume()
      speechSynthesis.cancel()

      if (prefs.engine === "supertonic") {
        const { createTtsHost } = await import("./tts-host.ts")
        if (mine !== generation) return
        host ??= createTtsHost(receive)
        neuralGeneration = mine
        host.speak({
          text: rule.source, lang: rule.language, voice: prefs.supertonicVoice,
          speed: prefs.speed, personalRules: [rule], detectLanguage: false,
        })
      } else {
        const text = expandText(rule.source, { language: rule.language, personalRules: [rule] })
        const utterance = new SpeechSynthesisUtterance(text)
        const voices = speechSynthesis.getVoices()
        const voice = voices.find((voice) => voice.voiceURI === prefs.voiceURI)
          ?? voices.find((voice) => voice.localService && voice.lang.split("-")[0] === rule.language)
        if (voice) utterance.voice = voice
        utterance.lang = rule.language
        utterance.rate = prefs.speed
        utterance.addEventListener("start", () => {
          if (mine === generation && token) onState({ phase: "playing", block: 0, total: 1 })
        })
        utterance.addEventListener("end", () => {
          if (mine !== generation || !token) return
          release()
          onState({ phase: "ended" })
        })
        utterance.addEventListener("error", () => {
          if (mine !== generation || !token) return
          release()
          onState({ phase: "error", message: "speech", reason: "audio-playback" })
        })
        nativeOwned = true
        speechSynthesis.speak(utterance)
      }
    } catch (error) {
      if (mine !== generation) return
      stop()
      onState({ phase: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }

  return { speak, stop }
}
