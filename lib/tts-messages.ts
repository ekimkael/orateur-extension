/**
 * Protocole entre la pastille (content script), le service worker et l'hôte
 * Supertonic (document offscreen sur Chrome, page de fond sur Firefox).
 *
 * Seul module de ce lot que `reader.content.ts` a le droit d'importer avec
 * `supertonic-lang.ts` : aucune dépendance vers `lib/supertonic/*` ni
 * `lib/tts-host.ts`, pour que le moteur ne fuie jamais dans le bundle chargé
 * sur toutes les pages. `SupertonicVoice` est importé en type-only depuis
 * `./supertonic/types` — effacé à la compilation, donc sans coût de bundle,
 * ce qui est le seul import de cette famille qui soit sans risque ici.
 */
import type { SupertonicVoice } from "./supertonic/types"
import type { SupportedLang } from "./supertonic-lang"

export const TTS_SPEAK = "orateur:tts:speak"
export const TTS_CONTROL = "orateur:tts:control"
export const TTS_EVENT = "orateur:tts:event"
export const TTS_CLOSE = "orateur:tts:close"

export interface TtsSpeakMessage {
  type: typeof TTS_SPEAK
  text: string
  title?: string
  lang: SupportedLang
  voice: SupertonicVoice
  speed: number
  /** Le jeton de la pastille émettrice — même mécanisme que READER_TOKEN. */
  token: string
  tabId: number
}

export type TtsControlAction = "pause" | "resume" | "stop"

export interface TtsControlMessage {
  type: typeof TTS_CONTROL
  action: TtsControlAction
}

/** Reflète 1:1 les états de la pastille — voir PillState dans reader.content.ts. */
export type TtsState =
  | { phase: "loading"; label?: string }
  | { phase: "playing"; block: number; total: number }
  | { phase: "paused" }
  | { phase: "ended" }
  | { phase: "error"; message: string }

export interface TtsEventMessage {
  type: typeof TTS_EVENT
  tabId: number
  state: TtsState
}
