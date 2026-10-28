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

import type { TtsHost } from "./tts-host.ts"
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
  token: string | null
}

/**
 * Serves reading ports for one TTS host.
 *
 * @param createHost Builds the host with the state callback the server
 *   forwards to the owning tab; wrap it to observe states as well.
 */
export function createTtsServer(createHost: (onState: (state: TtsState) => void) => TtsHost) {
  let owner: Reading | null = null
  let nextRequest = 0
  const pending = new Map<number, { port: TtsPort; resolve: (prepared: TtsPreparedBlock | null) => void; reject: (error: Error) => void }>()

  const host = createHost((state) => {
    owner?.port.postMessage({ type: TTS_EVENT, state } satisfies TtsEventMessage)
    if (state.phase === "ended" || state.phase === "error") release()
  })

  /** Forgets the owner; its unanswered paragraph requests fail. */
  function release() {
    owner = null
    for (const request of pending.values()) request.reject(new Error("Page disconnected"))
    pending.clear()
  }

  function stop() {
    host.control("stop")
    release()
  }

  function requestParagraph(reading: Reading, block: number, prefetch: boolean) {
    if (owner !== reading) return Promise.reject(new Error("Page disconnected"))
    const id = ++nextRequest
    return new Promise<TtsPreparedBlock | null>((resolve, reject) => {
      pending.set(id, { port: reading.port, resolve, reject })
      reading.port.postMessage({ type: TTS_PREPARE_BLOCK, id, block, prefetch } satisfies TtsPrepareBlockMessage)
    }) as Promise<TtsPreparedBlock>
  }

  function receive(port: TtsPort, tabId: number, message: Incoming) {
    if (message?.type === TTS_SPEAK) {
      if (!message.text || !message.lang || !message.voice) return
      const token = message.token
      if (message.livePage && (typeof token !== "string" || !token)) return
      release()
      const reading: Reading = { port, tabId, token: token ?? null }
      owner = reading
      host.speak({
        text: message.text,
        lang: message.lang,
        voice: message.voice,
        speed: message.speed ?? 1,
        startBlock: message.startBlock,
        personalRules: message.personalRules,
        prepareParagraph: message.livePage ? (block, prefetch = false) => requestParagraph(reading, block, prefetch) : undefined,
      })
      return
    }
    if (message?.type === TTS_PREPARED) {
      const request = pending.get(message.id!)
      if (!request || request.port !== port) return
      pending.delete(message.id!)
      request.resolve(message.prepared ?? null)
      return
    }
    // A tab that lost the floor cannot drive someone else's reading.
    if (owner?.port !== port) return
    if (message?.type === TTS_CONTROL && message.action) {
      host.control(message.action)
    } else if (message?.type === TTS_SET_SPEED && message.speed != null) {
      host.setSpeed(message.speed)
    } else if (message?.type === TTS_SEEK && Number.isInteger(message.block) && message.block! >= 0 && typeof message.paused === "boolean") {
      host.seek(message.block!, message.paused)
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
