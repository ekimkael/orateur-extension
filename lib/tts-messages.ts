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
/** L'hôte demande sa propre fermeture après un délai d'inactivité — voir offscreen/main.ts. */
export const TTS_CLOSE = "orateur:tts:close"
/**
 * Un document offscreen n'a pas `browser.storage` (vérifié en phase 0) : le
 * service worker relaie donc lui-même les changements de READER_TOKEN, plutôt
 * que de laisser l'hôte s'y abonner directement comme le fait chaque pastille.
 */
export const TTS_TOKEN_CHANGED = "orateur:tts:token-changed"
/**
 * Filet complémentaire à READER_TOKEN : l'onglet qui lisait a pu être fermé
 * sans qu'aucun autre onglet n'ait pris la parole — READER_TOKEN ne bouge
 * pas dans ce cas, alors que plus personne ne peut arrêter l'audio.
 */
export const TTS_TAB_REMOVED = "orateur:tts:tab-removed"
/**
 * Séparé de TTS_CONTROL : `tts-host.ts` expose `setSpeed` comme une méthode à
 * part de `control(action)`, appliquée en direct sur `audio.playbackRate`
 * sans passer par la file pause/reprise/arrêt.
 */
export const TTS_SET_SPEED = "orateur:tts:set-speed"

export interface TtsSpeakMessage {
  type: typeof TTS_SPEAK
  text: string
  title?: string
  lang: SupportedLang
  voice: SupertonicVoice
  speed: number
  /** Le jeton de la pastille émettrice — même mécanisme que READER_TOKEN. */
  token: string
  /**
   * Absent quand la pastille envoie ce message : elle ne connaît pas son
   * propre onglet. Le service worker le renseigne depuis `sender.tab.id`
   * avant de relayer vers l'hôte, qui en a besoin pour savoir à qui répondre.
   */
  tabId?: number
}

export type TtsControlAction = "pause" | "resume" | "stop"

export interface TtsControlMessage {
  type: typeof TTS_CONTROL
  action: TtsControlAction
}

/** Reflète 1:1 les états de la pastille — voir PillState dans reader.content.ts. */
export type TtsState =
  | { phase: "loading"; label?: string; progress?: number }
  | { phase: "playing"; block: number; total: number }
  | { phase: "paused" }
  | { phase: "ended" }
  | { phase: "error"; message: string }

export interface TtsEventMessage {
  type: typeof TTS_EVENT
  tabId: number
  state: TtsState
}

export interface TtsTokenChangedMessage {
  type: typeof TTS_TOKEN_CHANGED
  /** Nouvelle valeur de READER_TOKEN ; absente quand la clé est effacée. */
  token: string | undefined
}

export interface TtsTabRemovedMessage {
  type: typeof TTS_TAB_REMOVED
  tabId: number
}

export interface TtsSetSpeedMessage {
  type: typeof TTS_SET_SPEED
  speed: number
}

export interface TtsCloseMessage {
  type: typeof TTS_CLOSE
}
