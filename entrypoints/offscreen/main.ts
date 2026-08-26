/**
 * L'hôte Supertonic côté Chrome : un document offscreen, seul contexte MV3
 * capable de DOM + `<audio>` hors d'un onglet. Le service worker relaie tout
 * dans les deux sens — ce document n'a que `chrome.runtime`, ni `tabs` ni
 * `storage` (vérifié en phase 0). Sur Firefox, l'hôte vit directement dans
 * la page de fond (voir background.ts) : ce fichier n'existe pas là-bas.
 */
import { createTtsHost } from "../../lib/tts-host"
import { loadModelFiles } from "../../lib/supertonic/model-cache"
import {
  MODEL_DOWNLOAD_CANCEL,
  MODEL_DOWNLOAD_START,
  MODEL_PROGRESS,
  MODEL_STATE_QUERY,
  TTS_CLOSE,
  TTS_CONTROL,
  TTS_EVENT,
  TTS_SET_SPEED,
  TTS_SPEAK,
  TTS_TAB_REMOVED,
  TTS_TOKEN_CHANGED,
  type ModelProgressState,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsSetSpeedMessage,
  type TtsSpeakMessage,
  type TtsTabRemovedMessage,
  type TtsTokenChangedMessage,
} from "../../lib/tts-messages"

let currentTabId: number | null = null
let currentToken: string | null = null

/**
 * ponytail: hôte gardé au chaud 3 min après le dernier événement — trop
 * court rechargerait les ~400 Mo de sessions à chaque article, trop long
 * les garde résidents pour rien une fois la lecture terminée. Monter la
 * constante si le rechargement se fait sentir en usage réel.
 */
const IDLE_CLOSE_MS = 3 * 60_000
let idleTimer: ReturnType<typeof setTimeout> | null = null

/** Reporté à chaque événement d'état, playing/paused compris : tant que
 *  quelque chose se passe, l'hôte reste. Le silence, lui, se mesure. */
function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    // Un téléchargement de 398 Mo ne doit jamais être coupé en plein vol —
    // les avancées de loadModelFiles() rappellent déjà scheduleIdleClose()
    // (voir setModelState ci-dessous), ce filet ne joue que si, pour une
    // raison quelconque, aucune avancée n'est arrivée depuis 3 min.
    if (modelDownloading) {
      scheduleIdleClose()
      return
    }
    // Défensif : `stop()` a déjà tout révoqué à la fin normale d'une
    // lecture, mais un hôte resté en pause n'a jamais purgé ses créneaux.
    host.control("stop")
    void browser.runtime.sendMessage({ type: TTS_CLOSE }).catch(() => {})
  }, IDLE_CLOSE_MS)
}

/**
 * Téléchargement explicite du modèle (jalon 1d) — voir l'en-tête de
 * tts-messages.ts pour pourquoi REQUEST/START sont deux constantes
 * distinctes. `modelState` est la seule source de vérité pour
 * MODEL_STATE_QUERY : ce document n'existe QUE si une lecture ou un
 * téléchargement est en cours, donc son état mémoire ne se perd jamais entre
 * deux questions comme le ferait celui d'un service worker.
 */
let modelState: ModelProgressState = { phase: "idle" }
let modelDownloading = false
let modelAbort: AbortController | null = null

function setModelState(state: ModelProgressState) {
  modelState = state
  scheduleIdleClose()
  void browser.runtime.sendMessage({ type: MODEL_PROGRESS, state }).catch(() => {})
}

async function runModelDownload() {
  if (modelDownloading) return
  modelDownloading = true
  modelAbort = new AbortController()
  setModelState({ phase: "downloading", loaded: 0, total: 0 })
  try {
    await loadModelFiles((p) => {
      if (p.phase === "checking" || p.phase === "cached") return
      setModelState({ phase: "downloading", loaded: p.bytesLoaded, total: p.bytesTotal })
    }, modelAbort.signal)
    setModelState({ phase: "done" })
    // "done" est un événement, pas un état de repos : une page d'options qui
    // interroge MODEL_STATE_QUERY après coup doit voir "idle" comme si de
    // rien n'était, pas rejouer indéfiniment la fin d'un téléchargement
    // révolu. Assignation directe, pas setModelState() : rien à rediffuser.
    modelState = { phase: "idle" }
  } catch (e) {
    if (modelAbort.signal.aborted) {
      setModelState({ phase: "idle" })
    } else {
      setModelState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
    }
  } finally {
    modelDownloading = false
    modelAbort = null
  }
}

const host = createTtsHost((state) => {
  scheduleIdleClose()
  if (currentTabId == null) return
  const event: TtsEventMessage = { type: TTS_EVENT, tabId: currentTabId, state }
  void browser.runtime.sendMessage(event).catch(() => {})
  if (state.phase === "ended" || state.phase === "error") {
    currentTabId = null
    currentToken = null
  }
})

// Un document sans lecture ne doit pas non plus rester ouvert indéfiniment
// — l'arrivée du premier TTS_SPEAK relance le compte comme n'importe quel
// autre événement.
scheduleIdleClose()

type IncomingMessage =
  | Partial<TtsSpeakMessage>
  | Partial<TtsControlMessage>
  | Partial<TtsSetSpeedMessage>
  | Partial<TtsTokenChangedMessage>
  | Partial<TtsTabRemovedMessage>

browser.runtime.onMessage.addListener((message: IncomingMessage, sender) => {
  // Un message envoyé par une pastille arrive ici en double : une fois tel
  // quel (diffusion directe aux contextes de l'extension, `sender.tab`
  // renseigné), une fois relayé par le service worker (`sender.tab` absent —
  // c'est lui l'expéditeur de ce second envoi). Seul le relais compte : lui
  // seul porte le `tabId` que le service worker y a ajouté.
  if (sender.tab) return

  if (message?.type === TTS_SPEAK) {
    if (message.tabId == null || !message.text || !message.lang || !message.voice) return
    currentTabId = message.tabId
    currentToken = message.token ?? null
    host.speak({ text: message.text, lang: message.lang, voice: message.voice, speed: message.speed ?? 1 })
    return
  }
  if (message?.type === TTS_CONTROL && message.action) {
    host.control(message.action)
    return
  }
  if (message?.type === TTS_SET_SPEED && message.speed != null) {
    host.setSpeed(message.speed)
    return
  }
  if (message?.type === TTS_TOKEN_CHANGED) {
    // Notre propre jeton qui repasse (rien à faire), ou un autre onglet qui
    // vient de prendre la parole : dans ce dernier cas l'audio continuerait
    // sans plus aucune pastille pour l'arrêter si on ne coupait pas ici.
    if (message.token === currentToken) return
    host.control("stop")
    currentTabId = null
    currentToken = null
    return
  }
  if (message?.type === TTS_TAB_REMOVED) {
    // Filet complémentaire à READER_TOKEN : l'onglet qui lisait a pu être
    // fermé sans qu'aucun autre n'ait pris la parole entre-temps.
    if (message.tabId !== currentTabId) return
    host.control("stop")
    currentTabId = null
    currentToken = null
  }
})

// Téléchargement du modèle : START/CANCEL/STATE_QUERY n'ont pas le problème
// de double réception ci-dessus (voir l'en-tête de tts-messages.ts), pas de
// garde sur `sender.tab` à faire ici.
browser.runtime.onMessage.addListener(
  (message: { type?: string }, _sender, sendResponse) => {
    if (message?.type === MODEL_DOWNLOAD_START) {
      void runModelDownload()
      return
    }
    if (message?.type === MODEL_DOWNLOAD_CANCEL) {
      modelAbort?.abort()
      return
    }
    if (message?.type === MODEL_STATE_QUERY) {
      sendResponse(modelState)
      return
    }
  }
)
