/**
 * The TTS host's side of the reading ports, shared by the Chrome offscreen
 * document and the Firefox background page.
 *
 * One reading owns the host at a time: the last port to send `TTS_SPEAK`.
 * Only its commands count, only it gets the events, and its paragraph
 * requests travel back over the same port — no tab id, no relay.
 *
 * A port closing stops its reading. That is not enough on its own: Firefox
 * keeps a page's port open while the page sits in the back-forward cache, so
 * the token and tab-removed signals still come from the background.
 */

import type { SpeakRequest } from "./tts-host.ts"
import type { LocalTtsHost, PocketSpeakRequest } from "./local-tts-host.ts"
import { isPocketVoice, POCKET_LANGUAGES } from "./pocket/catalog.ts"
import { SPEED } from "./reader-prefs.ts"
import { AVAILABLE_LANGS } from "./supertonic-lang.ts"
import { SUPERTONIC_VOICES } from "./supertonic/types.ts"
import {
  TTS_CONTROL,
  TTS_EVENT,
  TTS_PORT,
  TTS_PREPARE_BLOCK,
  TTS_PREPARED,
  TTS_SEEK,
  TTS_SET_SPEED,
  TTS_SPEAK,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsPrepareBlockMessage,
  type TtsPreparedBlock,
  type TtsPreparedMessage,
  type TtsSeekMessage,
  type TtsSetSpeedMessage,
  type TtsSpeakMessage,
  type TtsState,
  type LocalTtsEngine,
} from "./tts-messages.ts"

/** The part of `runtime.Port` the host uses. */
export interface TtsPort {
  name: string
  sender?: { tab?: { id?: number } }
  postMessage(message: unknown): void
  onMessage: { addListener(listener: (message: any) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
}

type Incoming =
  | Partial<TtsSpeakMessage>
  | Partial<TtsControlMessage>
  | Partial<TtsSetSpeedMessage>
  | Partial<TtsSeekMessage>
  | Partial<TtsPreparedMessage>

interface Reading {
  port: TtsPort
  tabId: number
  token: string
  engine: LocalTtsEngine
}

type ActiveHost =
  | { engine: "supertonic"; host: LocalTtsHost<SpeakRequest> }
  | { engine: "pocket"; host: LocalTtsHost<PocketSpeakRequest> }

const supertonicLanguages = new Set<string>(AVAILABLE_LANGS)
const supertonicVoices = new Set<string>(SUPERTONIC_VOICES)
const pocketLanguages = new Set<string>(POCKET_LANGUAGES)

function validSpeed(value: unknown): value is number {
  return typeof value === "number" && value >= SPEED.min && value <= SPEED.max
}

/** Validate before taking ownership: a malformed message must not stop another tab. */
function validSpeak(message: Partial<TtsSpeakMessage>): message is TtsSpeakMessage {
  if (typeof message.text !== "string" || !message.text.trim() ||
    typeof message.lang !== "string" || typeof message.voice !== "string" ||
    typeof message.token !== "string" || !message.token ||
    !validSpeed(message.speed) ||
    (message.startBlock !== undefined && (!Number.isInteger(message.startBlock) || message.startBlock < 0)) ||
    (message.livePage !== undefined && typeof message.livePage !== "boolean")) return false
  if (message.engine === "pocket") {
    return pocketLanguages.has(message.lang) && isPocketVoice(message.voice) &&
      (message.cacheOnly === undefined || typeof message.cacheOnly === "boolean")
  }
  return (message.engine === undefined || message.engine === "supertonic") &&
    supertonicLanguages.has(message.lang) && supertonicVoices.has(message.voice) &&
    (message.personalRules === undefined || Array.isArray(message.personalRules))
}

/**
 * Serves local engines behind one owner, loading only the selected host.
 *
 * @param createHost Builds Supertonic's host; existing callers need no Pocket factory.
 * @param createPocketHost Builds Pocket's host with its own synthesis and cache.
 */
export function createTtsServer(
  createHost: (onState: (state: TtsState) => void) => LocalTtsHost<SpeakRequest>,
  createPocketHost?: (onState: (state: TtsState) => void) => LocalTtsHost<PocketSpeakRequest>,
) {
  let owner: Reading | null = null
  let active: ActiveHost | null = null
  let hostGeneration = 0
  let nextRequest = 0
  const pending = new Map<number, { reading: Reading; resolve: (prepared: TtsPreparedBlock<string> | null) => void; reject: (error: Error) => void }>()

  function activate(engine: LocalTtsEngine): ActiveHost {
    if (active?.engine === engine) return active
    const previous = active
    active = null
    const generation = ++hostGeneration
    // Invalidate callbacks before stopping: stop/dispose may emit synchronously.
    previous?.host.control("stop")
    previous?.host.dispose?.()
    const onState = (state: TtsState) => {
      if (generation !== hostGeneration || !owner) return
      owner.port.postMessage({ type: TTS_EVENT, state } satisfies TtsEventMessage)
      if (state.phase === "ended" || state.phase === "error") release()
    }
    active = engine === "pocket"
      ? { engine, host: createPocketHost!(onState) }
      : { engine, host: createHost(onState) }
    return active
  }

  /** Forgets the owner; its unanswered paragraph requests fail. */
  function release() {
    owner = null
    for (const request of pending.values()) request.reject(new Error("Page disconnected"))
    pending.clear()
  }

  function stop() {
    release()
    active?.host.control("stop")
  }

  function requestParagraph(reading: Reading, block: number, prefetch: boolean) {
    if (owner !== reading) return Promise.reject(new Error("Page disconnected"))
    const id = ++nextRequest
    return new Promise<TtsPreparedBlock<string> | null>((resolve, reject) => {
      pending.set(id, { reading, resolve, reject })
      reading.port.postMessage({ type: TTS_PREPARE_BLOCK, id, block, prefetch } satisfies TtsPrepareBlockMessage)
    })
  }

  function receive(port: TtsPort, tabId: number, message: Incoming) {
    if (message?.type === TTS_SPEAK) {
      if (!validSpeak(message) || (message.engine === "pocket" && !createPocketHost)) return
      release()
      const engine = message.engine ?? "supertonic"
      const reading: Reading = { port, tabId, token: message.token, engine }
      try {
        const target = activate(engine)
        owner = reading
        const common = {
          text: message.text, speed: message.speed, startBlock: message.startBlock,
        }
        if (target.engine === "pocket" && message.engine === "pocket") {
          target.host.speak({
            ...common, lang: message.lang, voice: message.voice, cacheOnly: message.cacheOnly,
            prepareParagraph: message.livePage ? (block, prefetch = false) => requestParagraph(reading, block, prefetch) : undefined,
          })
        } else if (target.engine === "supertonic" && message.engine !== "pocket") {
          target.host.speak({
            ...common, lang: message.lang, voice: message.voice, personalRules: message.personalRules,
            prepareParagraph: message.livePage
              ? (block, prefetch = false) => requestParagraph(reading, block, prefetch) as Promise<TtsPreparedBlock>
              : undefined,
          })
        }
      } catch {
        stop()
        port.postMessage({ type: TTS_EVENT, state: { phase: "error", message: "Unable to start speech." } } satisfies TtsEventMessage)
      }
      return
    }
    if (message?.type === TTS_PREPARED) {
      const request = pending.get(message.id!)
      if (!request || request.reading.port !== port) return
      pending.delete(message.id!)
      const prepared = message.prepared
      const languages = request.reading.engine === "pocket" ? pocketLanguages : supertonicLanguages
      if (prepared == null) request.resolve(null)
      else if (typeof prepared.text !== "string" || typeof prepared.lang !== "string" ||
        !languages.has(prepared.lang)) {
        request.reject(new Error("Invalid prepared paragraph"))
      } else request.resolve(prepared)
      return
    }
    // A tab that lost the floor cannot drive someone else's reading.
    if (owner?.port !== port || !active) return
    if (message?.type === TTS_CONTROL && (message.action === "pause" || message.action === "resume" || message.action === "stop")) {
      if (message.action === "stop") stop()
      else active.host.control(message.action)
    } else if (message?.type === TTS_SET_SPEED && validSpeed(message.speed)) {
      active.host.setSpeed(message.speed)
    } else if (message?.type === TTS_SEEK && Number.isInteger(message.block) && message.block! >= 0 && typeof message.paused === "boolean") {
      active.host.seek(message.block!, message.paused)
    }
  }

  return {
    /** `runtime.onConnect` listener: accepts reading ports from content scripts only. */
    connect(port: TtsPort) {
      const tabId = port.sender?.tab?.id
      if (port.name !== TTS_PORT || tabId == null) return
      port.onMessage.addListener((message: Incoming) => receive(port, tabId, message))
      port.onDisconnect.addListener(() => {
        if (owner?.port === port) stop()
      })
    },
    /** Stops the current reading, if any, and forgets its tab. */
    stop,
    /**
     * Notre propre jeton qui repasse (rien à faire), ou un autre onglet qui
     * vient de prendre la parole : dans ce dernier cas l'audio continuerait
     * sans plus aucune pastille pour l'arrêter si on ne coupait pas ici.
     */
    tokenChanged(token: string | undefined) {
      if (owner && token === owner.token) return
      stop()
    },
    /**
     * Filet complémentaire à READER_TOKEN : l'onglet qui lisait a pu être
     * fermé sans qu'aucun autre n'ait pris la parole entre-temps.
     */
    tabRemoved(tabId: number) {
      if (owner?.tabId === tabId) stop()
    },
  }
}
