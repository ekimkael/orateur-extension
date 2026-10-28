/**
 * L'hôte Supertonic côté Chrome : un document offscreen, seul contexte MV3
 * capable de DOM + `<audio>` hors d'un onglet. Les lectures s'y connectent
 * directement par port (`lib/tts-port.ts`) ; le service worker ne fait que
 * l'ouvrir et lui relayer ce qu'il ne voit pas — ce document n'a que
 * `chrome.runtime`, ni `tabs` ni `storage` (vérifié en phase 0). Sur Firefox,
 * l'hôte vit directement dans la page de fond (voir background.ts) : ce
 * fichier n'existe pas là-bas.
 */
import { createTtsHost } from "../../lib/tts-host"
import { createTtsServer } from "../../lib/tts-port"
import { loadModelFiles } from "../../lib/supertonic/model-cache"
import {
  MODEL_DOWNLOAD_CANCEL,
  MODEL_DOWNLOAD_START,
  MODEL_PROGRESS,
  MODEL_STATE_QUERY,
  TTS_CLOSE,
  TTS_TAB_REMOVED,
  TTS_TOKEN_CHANGED,
  type ModelProgressState,
  type TtsTabRemovedMessage,
  type TtsTokenChangedMessage,
} from "../../lib/tts-messages"

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
    server.stop()
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

const server = createTtsServer((forward) => createTtsHost((state) => {
  scheduleIdleClose()
  forward(state)
}))
browser.runtime.onConnect.addListener(server.connect)

// Un document sans lecture ne doit pas non plus rester ouvert indéfiniment
// — l'arrivée du premier TTS_SPEAK relance le compte comme n'importe quel
// autre événement.
scheduleIdleClose()

browser.runtime.onMessage.addListener((message: Partial<TtsTokenChangedMessage> | Partial<TtsTabRemovedMessage>, sender) => {
  // Seul le service worker relaie ces signaux ; une pastille n'a rien à dire ici.
  if (sender.tab) return
  if (message?.type === TTS_TOKEN_CHANGED) server.tokenChanged(message.token)
  else if (message?.type === TTS_TAB_REMOVED && message.tabId != null) server.tabRemoved(message.tabId)
})

// Téléchargement du modèle : START/CANCEL/STATE_QUERY, reçus directement.
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
