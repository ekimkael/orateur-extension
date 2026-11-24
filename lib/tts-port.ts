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
import type { LocalTtsHost, ChunkedSpeakRequest } from "./local-tts-host.ts"
import { isKaleVoice } from "./kale/catalog.ts"
import { isPhononLanguage } from "./phonon/config.ts"
import { isPocketVoice, POCKET_LANGUAGES } from "./pocket/catalog.ts"
import { createSpeechPreparation, prepareSpeech } from "./prepare-speech.ts"
import { sanitizePronunciationRules, type PronunciationRule } from "./pronunciation/personal.ts"
import { splitBlocks } from "./reading-language.ts"
import { SPEED } from "./reader-prefs.ts"
import { AVAILABLE_LANGS, toSupertonicLang } from "./supertonic-lang.ts"
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
  legacyRules?: PronunciationRule[]
}

type ActiveHost =
  | { engine: "supertonic"; host: LocalTtsHost<SpeakRequest> }
  | { engine: "pocket" | "kale" | "phonon"; host: LocalTtsHost<ChunkedSpeakRequest> }

const supertonicLanguages = new Set<string>(AVAILABLE_LANGS)
const supertonicVoices = new Set<string>(SUPERTONIC_VOICES)
const pocketLanguages = new Set<string>(POCKET_LANGUAGES)
const languagesByEngine = {
  supertonic: supertonicLanguages, pocket: pocketLanguages, kale: new Set(["en"]), phonon: new Set(["en", "fr"]),
}

/** A reading that cannot start must say so: its pill would otherwise stay on "loading". */
const START_FAILED = { type: TTS_EVENT, state: { phase: "error", message: "Unable to start speech." } } satisfies TtsEventMessage

function validSpeed(value: unknown): value is number {
  return typeof value === "number" && value >= SPEED.min && value <= SPEED.max
}

function validBlock(value: unknown, languages: ReadonlySet<string>): value is TtsPreparedBlock<string> {
  if (!value || typeof value !== "object") return false
  const block = value as Partial<TtsPreparedBlock<string>>
  return typeof block.text === "string" && (block.text === "" || !!block.text.trim()) &&
    typeof block.lang === "string" && languages.has(block.lang)
}

/** Validate before taking ownership: a malformed message must not stop another tab. */
function validSpeak(message: Partial<TtsSpeakMessage>): message is TtsSpeakMessage {
  if (message.engine !== undefined &&
      (typeof message.engine !== "string" || !Object.hasOwn(languagesByEngine, message.engine))) return false
  const languages = languagesByEngine[message.engine ?? "supertonic"]
  const validText = message.paragraphs === undefined
    ? typeof message.text === "string" && !!message.text.trim()
    : message.text === undefined && Array.isArray(message.paragraphs) && message.paragraphs.length > 0 &&
      Array.from(message.paragraphs).every((paragraph) => validBlock(paragraph, languages))
  if (!validText || typeof message.lang !== "string" || typeof message.voice !== "string" ||
    typeof message.token !== "string" || !message.token ||
    !validSpeed(message.speed) ||
    (message.startBlock !== undefined && (!Number.isInteger(message.startBlock) || message.startBlock < 0)) ||
    (message.livePage !== undefined && typeof message.livePage !== "boolean")) return false
  if (message.engine === "pocket" || message.engine === "phonon") {
    const validVoice = message.engine === "phonon" ? isPhononLanguage(message.lang) && message.voice === "auto"
      : pocketLanguages.has(message.lang) && isPocketVoice(message.voice)
    return validVoice &&
      (message.cacheOnly === undefined || typeof message.cacheOnly === "boolean")
  }
  if (message.engine === "kale") {
    return message.lang === "en" && isKaleVoice(message.voice) &&
      (message.cacheOnly === undefined || typeof message.cacheOnly === "boolean") &&
      (message.webGpu === undefined || typeof message.webGpu === "boolean")
  }
  return (message.engine === undefined || message.engine === "supertonic") &&
    supertonicLanguages.has(message.lang) && supertonicVoices.has(message.voice) &&
    (message.personalRules === undefined || Array.isArray(message.personalRules))
}

/** Old tabs send raw text. Prepare it once before handing it to the host. */
function legacyParagraphs(text: string, message: TtsSpeakMessage, personalRules: PronunciationRule[]) {
  return createSpeechPreparation({ paragraphs: splitBlocks(text), text, title: "", personalRules }, message.lang)
    .paragraphs.map((paragraph) => ({
      text: paragraph.text,
      lang: message.engine === undefined || message.engine === "supertonic"
        ? toSupertonicLang(paragraph.lang) ?? message.lang : message.lang,
    }))
}

/**
 * Serves local engines behind one owner, loading only the selected host.
 *
 * @param createHost Builds Supertonic's host; existing callers need no Pocket factory.
 * @param createPocketHost Builds Pocket's host with its own synthesis and cache.
 * @param createKaleHost Builds Kale's host.
 * @param createPhononHost Builds Phonon's host when a model source is configured.
 */
export function createTtsServer(
  createHost: (onState: (state: TtsState) => void) => LocalTtsHost<SpeakRequest>,
  createPocketHost?: (onState: (state: TtsState) => void) => LocalTtsHost<ChunkedSpeakRequest>,
  createKaleHost?: (onState: (state: TtsState) => void) => LocalTtsHost<ChunkedSpeakRequest>,
  createPhononHost?: (onState: (state: TtsState) => void) => LocalTtsHost<ChunkedSpeakRequest>,
) {
  const chunkedHosts = { pocket: createPocketHost, kale: createKaleHost, phonon: createPhononHost }
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
    active = engine === "supertonic"
      ? { engine, host: createHost(onState) }
      : { engine, host: chunkedHosts[engine]!(onState) }
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
      if (!validSpeak(message) ||
          (message.engine !== undefined && message.engine !== "supertonic" && !chunkedHosts[message.engine])) {
        // Answer the refused port only: the current owner keeps reading.
        port.postMessage(START_FAILED)
        return
      }
      const engine = message.engine ?? "supertonic"
      const reading: Reading = { port, tabId, token: message.token, engine }
      let paragraphs = message.paragraphs
      if (!paragraphs) {
        reading.legacyRules = engine === "supertonic" ? sanitizePronunciationRules(message.personalRules) : []
        try {
          paragraphs = legacyParagraphs(message.text!, message, reading.legacyRules)
        } catch {
          port.postMessage(START_FAILED)
          return
        }
      }
      release()
      try {
        const target = activate(engine)
        owner = reading
        const common = {
          paragraphs, speed: message.speed, startBlock: message.startBlock,
          prepareParagraph: message.livePage ? (block: number, prefetch = false) => requestParagraph(reading, block, prefetch) : undefined,
        }
        if (target.engine !== "supertonic" && (message.engine === "pocket" || message.engine === "kale" || message.engine === "phonon")) {
          target.host.speak({
            ...common, lang: message.lang, voice: message.voice, cacheOnly: message.cacheOnly,
            webGpu: message.engine === "kale" ? message.webGpu : undefined,
          })
        } else if (target.engine === "supertonic" && (message.engine === undefined || message.engine === "supertonic")) {
          target.host.speak({
            ...common, voice: message.voice, paragraphs: paragraphs as TtsPreparedBlock[],
            prepareParagraph: common.prepareParagraph as SpeakRequest["prepareParagraph"],
          })
        }
      } catch {
        stop()
        port.postMessage(START_FAILED)
      }
      return
    }
    if (message?.type === TTS_PREPARED) {
      const request = pending.get(message.id!)
      if (!request || request.reading.port !== port) return
      pending.delete(message.id!)
      const prepared = message.prepared
      const languages = languagesByEngine[request.reading.engine]
      if (prepared == null) request.resolve(null)
      else if (!validBlock(prepared, languages)) {
        request.reject(new Error("Invalid prepared paragraph"))
      } else {
        try {
          const rules = request.reading.legacyRules
          request.resolve(rules ? { ...prepared, text: prepareSpeech(prepared.text, prepared.lang, rules) } : prepared)
        } catch {
          request.reject(new Error("Invalid prepared paragraph"))
        }
      }
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
