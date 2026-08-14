/**
 * L'hôte Supertonic côté Chrome : un document offscreen, seul contexte MV3
 * capable de DOM + `<audio>` hors d'un onglet. Le service worker relaie tout
 * dans les deux sens — ce document n'a que `chrome.runtime`, ni `tabs` ni
 * `storage` (vérifié en phase 0). Sur Firefox, l'hôte vit directement dans
 * la page de fond (voir background.ts) : ce fichier n'existe pas là-bas.
 */
import { createTtsHost } from "../../lib/tts-host"
import {
  TTS_CLOSE,
  TTS_CONTROL,
  TTS_EVENT,
  TTS_SET_SPEED,
  TTS_SPEAK,
  TTS_TAB_REMOVED,
  TTS_TOKEN_CHANGED,
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
    // Défensif : `stop()` a déjà tout révoqué à la fin normale d'une
    // lecture, mais un hôte resté en pause n'a jamais purgé ses créneaux.
    host.control("stop")
    void browser.runtime.sendMessage({ type: TTS_CLOSE }).catch(() => {})
  }, IDLE_CLOSE_MS)
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
