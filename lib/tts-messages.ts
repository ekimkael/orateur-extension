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

/**
 * Cause d'une attente affichée dans le toast de la pastille.
 *
 * tts-host.ts n'a pas accès à `browser.i18n` (voir son en-tête : il ne connaît
 * ni les onglets ni `browser.*`) — il émet la cause, pas le texte déjà traduit,
 * et c'est reader.content.ts qui la traduit au rendu, comme le reste de ses
 * libellés.
 */
export type TtsLoadingReason =
  | "downloading-model"
  | "loading-engine"
  | "loading-voice"
  | "preparing-next"

/** Reflète 1:1 les états de la pastille — voir PillState dans reader.content.ts. */
export type TtsState =
  | { phase: "loading"; reason?: TtsLoadingReason; progress?: number }
  // `block` est un index de PARAGRAPHE (celui de `splitBlocks`), pas d'unité
  // de synthèse : c'est la seule position que la pastille puisse rapporter à
  // la page pour surligner ce qui se dit. `total` compte les paragraphes.
  | { phase: "playing"; block: number; total: number }
  | { phase: "paused" }
  | { phase: "ended" }
  // `reason` distingue la seule erreur statique et donc traduisible
  // (audio-playback, posée par tts-host.ts) d'une exception arbitraire
  // (ONNX, réseau…) : `message` en porte alors le texte brut, non traduit —
  // il n'y a rien de sensé à traduire dans un message d'exception.
  | { phase: "error"; message: string; reason?: "audio-playback" }

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

/**
 * Téléchargement explicite du modèle depuis la page d'options (jalon 1d) —
 * même hôte que la synthèse (document offscreen / page de fond), pour les
 * mêmes raisons : lui seul peut survivre à la fermeture de l'onglet options
 * et éviter un double téléchargement avec une lecture en cours.
 *
 * REQUEST et START sont volontairement deux constantes distinctes : sur
 * Chrome, `runtime.sendMessage` depuis la page d'options atteint TOUS les
 * contextes de l'extension, document offscreen compris (aucun `sender.tab`
 * pour les distinguer, contrairement à TTS_SPEAK depuis une pastille — voir
 * plus haut). Si le document offscreen écoutait REQUEST directement, un
 * appel arrivant alors qu'aucun document n'existe encore serait perdu, ET
 * une fois le document créé, il verrait la même REQUEST une seconde fois.
 * Seul le service worker (qui peut créer le document) écoute REQUEST ; seul
 * le document offscreen écoute START, qu'il reçoit après coup.
 *
 * CANCEL et STATE_QUERY n'ont pas ce problème : la page d'options qui les
 * envoie et le document offscreen qui les traite sont tous deux sans
 * `sender.tab`, donc CANCEL/QUERY se reçoivent directement, sans relais —
 * `entrypoints/background.ts` ne répond à STATE_QUERY que si aucun document
 * offscreen n'existe (sinon c'est lui qui répond, pour ne jamais avoir deux
 * `sendResponse()` sur le même message).
 */
export const MODEL_DOWNLOAD_REQUEST = "orateur:tts:model-download-request"
export const MODEL_DOWNLOAD_START = "orateur:tts:model-download-start"
export const MODEL_DOWNLOAD_CANCEL = "orateur:tts:model-download-cancel"
export const MODEL_STATE_QUERY = "orateur:tts:model-state-query"
/** Diffusé par l'hôte à chaque avancée — reçu directement par la page
 *  d'options, contexte d'extension comme un autre, sans relais. */
export const MODEL_PROGRESS = "orateur:tts:model-progress"

export type ModelDownloadPhase = "idle" | "downloading" | "error" | "done"

/** Octets, pas un pourcentage par fichier : six fichiers de tailles très
 *  différentes feraient sauter une barre indexée sur `fileIndex`. */
export interface ModelProgressState {
  phase: ModelDownloadPhase
  loaded?: number
  total?: number
  message?: string
}

export interface ModelDownloadRequestMessage {
  type: typeof MODEL_DOWNLOAD_REQUEST
}

export interface ModelDownloadStartMessage {
  type: typeof MODEL_DOWNLOAD_START
}

export interface ModelDownloadCancelMessage {
  type: typeof MODEL_DOWNLOAD_CANCEL
}

export interface ModelStateQueryMessage {
  type: typeof MODEL_STATE_QUERY
}

export interface ModelProgressMessage {
  type: typeof MODEL_PROGRESS
  state: ModelProgressState
}
