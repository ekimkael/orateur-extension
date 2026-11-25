/**
 * Local speech, from the page's side: the TTS host (offscreen document on
 * Chrome, background page on Firefox) synthesizes, schedules and keeps the
 * position; this player opens its own port to it (`lib/tts-port.ts`), sends
 * commands and translates the host's `TTS_EVENT`s into `PlayerEvent`s.
 *
 * Runtime imports stay out of this file: they would pull the engine
 * into the bundle of a script loaded on every page.
 */

import { createSpeechPreparation } from "./prepare-speech.ts"
import { toSupertonicLang, type SupportedLang } from "./supertonic-lang.ts"
import { PHONON_NAME, type PhononLanguage } from "./phonon/config.ts"
import type { PocketLanguage, PocketVoice } from "./pocket/catalog.ts"
import type { KaleVoice } from "./kale/catalog.ts"
import { track } from "./telemetry.ts"
import {
  TTS_CONTROL,
  TTS_EVENT,
  TTS_OPEN,
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
import type { Player, PlayerOptions } from "./player.ts"

/**
 * Reads with Supertonic through the TTS host.
 *
 * @param options.lang The language already resolved for the whole text.
 * @param options.token This tab's reader token, which the host compares with
 *   `READER_TOKEN` to stop when another tab takes the floor.
 */
export function createSupertonicPlayer(options: PlayerOptions & { lang: SupportedLang; token: string }): Player {
  return createLocalPlayer({ ...options, engine: "supertonic" })
}

/** Reads with Pocket through the same port, without pronunciation rules. */
export function createPocketPlayer(
  options: PlayerOptions & { lang: PocketLanguage; token: string; voice: PocketVoice; cacheOnly: boolean },
): Player {
  return createLocalPlayer({ ...options, engine: "pocket" })
}

/** Reads with the bundled Kale model through the local TTS port. */
export function createKalePlayer(options: PlayerOptions & { lang: "en"; token: string; voice: KaleVoice; cacheOnly: boolean; webGpu: boolean }): Player {
  return createLocalPlayer({ ...options, engine: "kale" })
}

/** Reads French and English with Phonon through the local TTS port. */
export function createPhononPlayer(options: PlayerOptions & { lang: PhononLanguage; token: string; voice: "auto"; cacheOnly: boolean }): Player {
  return createLocalPlayer({ ...options, engine: "phonon" })
}

function createLocalPlayer(options: PlayerOptions & { token: string } & (
  | { engine: "supertonic"; lang: SupportedLang }
  | { engine: "pocket"; lang: PocketLanguage; voice: PocketVoice; cacheOnly: boolean; webGpu?: never }
  | { engine: "kale"; lang: "en"; voice: KaleVoice; cacheOnly: boolean; webGpu: boolean }
  | { engine: "phonon"; lang: PhononLanguage; voice: "auto"; cacheOnly: boolean; webGpu?: never }
)): Player {
  const { engine, paragraphs, lang, startBlock, source, token, prefs, emit } = options
  const speech = createSpeechPreparation(options, lang)
  function modelBlock(paragraph: TtsPreparedBlock<string>): TtsPreparedBlock<string> {
    return { text: paragraph.text, lang: engine === "supertonic" ? toSupertonicLang(paragraph.lang) ?? lang : lang }
  }
  let block = startBlock
  let paused = false
  let disposed = false
  /**
   * True once a `reason: "downloading-model"` is seen during this reading,
   * so `<engine>_download_completed`/`_failed` (telemetry, milestone 1c)
   * count only real downloads, not every reading that finds the model cached.
   */
  const trackDownloads = engine === "pocket" || engine === "supertonic"
  let sawDownload = false
  /** Resolves to the open port, or to null once the reading is over. */
  let connection: Promise<Browser.runtime.Port | null> = Promise.resolve(null)
  let port: Browser.runtime.Port | null = null

  /** Commands sent before the port opens wait for it, in order; a closed port takes nothing. */
  function send(message: TtsSpeakMessage | TtsControlMessage | TtsSeekMessage | TtsSetSpeedMessage | TtsPreparedMessage) {
    void connection.then((open) => {
      if (open && open === port) open.postMessage(message)
    })
  }

  function open() {
    return browser.runtime.sendMessage({ type: TTS_OPEN }).catch(() => false).then((ready) => {
      if (disposed) return null
      if (!ready) {
        emit({
          phase: "error",
          reason: "preparation",
          message: engine === "phonon" ? browser.i18n.getMessage("errorLocalStartFailed", PHONON_NAME)
            : browser.i18n.getMessage(({
            pocket: "errorPocketStartFailed", supertonic: "errorSupertonicStartFailed", kale: "errorKaleSynthesis",
          } as const)[engine]),
        })
        return null
      }
      const opened = browser.runtime.connect({ name: TTS_PORT })
      opened.onMessage.addListener(receive)
      // The host went away mid-reading (Chrome closes an idle offscreen
      // document): nothing will answer this pill anymore.
      opened.onDisconnect.addListener(() => {
        port = null
        if (!disposed) emit({ phase: "error", reason: "preparation" })
      })
      port = opened
      return opened
    })
  }

  function receive(message: Partial<TtsEventMessage> | Partial<TtsPrepareBlockMessage>) {
    if (disposed) return
    if (message.type === TTS_EVENT) {
      const { state } = message as Partial<TtsEventMessage>
      if (state) onState(state)
    } else if (message.type === TTS_PREPARE_BLOCK) {
      const request = message as Partial<TtsPrepareBlockMessage>
      void prepare(request).catch(() => null).then((prepared) => {
        send({ type: TTS_PREPARED, id: request.id!, prepared })
      })
    }
  }

  function onState(state: TtsState) {
    if (state.phase === "loading") {
      // Telemetry (milestone 1c): once per reading, on the first
      // "downloading-model"; later progress ticks take this same branch
      // without firing the event again.
      if (trackDownloads && state.reason === "downloading-model" && !sawDownload) {
        sawDownload = true
        track({ name: `${engine}_download_started` })
      }
      emit({ phase: "loading", reason: state.reason, progress: state.progress })
    } else if (state.phase === "playing") {
      paused = false
      block = state.block
      emit({ phase: "playing", block: state.block, total: state.total })
      if (trackDownloads && sawDownload) {
        sawDownload = false
        track({ name: `${engine}_download_completed` })
      }
    } else if (state.phase === "paused") {
      paused = true
      emit({ phase: "paused" })
    } else if (state.phase === "ended") {
      emit({ phase: "ended" })
    } else if (state.phase === "error") {
      const audio = state.reason === "audio-playback"
      emit({
        phase: "error",
        reason: audio ? "audio_playback" : "preparation",
        // `state.message` from an exception (ONNX, network) cannot be
        // translated; only the hosts' static audio error can.
        message: audio ? browser.i18n.getMessage("ttsAudioError")
          : engine === "phonon" ? browser.i18n.getMessage("errorLocalSynthesis", PHONON_NAME)
          : engine === "pocket" ? browser.i18n.getMessage("errorPocketSynthesis")
          : engine === "kale" ? browser.i18n.getMessage("errorKaleSynthesis") : state.message,
      })
      if (trackDownloads && sawDownload) {
        sawDownload = false
        track({ name: `${engine}_download_failed`, properties: { reason: classifyTtsError(state.message) } })
      }
    }
  }

  function prepare(message: Partial<TtsPrepareBlockMessage>): Promise<TtsPreparedBlock<string> | null> {
    const index = message.block!
    if (!source || !Number.isInteger(message.id) ||
      !Number.isInteger(index) || index < 0 || index >= paragraphs.length ||
      (message.prefetch !== undefined && typeof message.prefetch !== "boolean")) return Promise.resolve(null)
    return source.prepare(index, prefs().follow, !!message.prefetch, index > block ? "nearest" : "center").then((text) => {
      if (disposed) return null
      return modelBlock(speech.refresh(index, text))
    })
  }

  /** Closing the port is what releases the host: it stops this reading. */
  function dispose() {
    disposed = true
    try {
      port?.disconnect()
    } catch {
      // Extension context invalidated: the port is already gone.
    }
    port = null
  }

  return {
    engine,
    hasSpeech: speech.hasSpeech,
    start() {
      emit({ phase: "loading" })
      connection = open()
      const request = {
        type: TTS_SPEAK,
        paragraphs: speech.paragraphs.map(modelBlock),
        lang,
        speed: prefs().speed,
        startBlock,
        token,
        livePage: !!source,
      } as const
      send(options.engine !== "supertonic"
        ? { ...request, engine: options.engine, voice: options.voice, cacheOnly: options.cacheOnly, webGpu: options.webGpu }
        : { ...request, engine: "supertonic", voice: prefs().supertonicVoice })
    },
    pause() {
      paused = true
      send({ type: TTS_CONTROL, action: "pause" })
    },
    resume() {
      paused = false
      send({ type: TTS_CONTROL, action: "resume" })
    },
    seek(target) {
      block = target
      send({ type: TTS_SEEK, block: target, paused })
    },
    update(previous) {
      // Speed applies at once (audio.playbackRate, never a new synthesis):
      // unlike the system voices, there is no reason to wait for a resume.
      //
      // ponytail: a voice change during a reading is not picked up on the
      // fly; the host keeps no text position to restart with another voice.
      // Stop and read again to hear it.
      const { speed } = prefs()
      if (speed !== previous.speed) {
        send({ type: TTS_SET_SPEED, speed })
      }
    },
    stop: dispose,
    dispose,
  }
}

/**
 * Roughly classifies a download error for telemetry (milestone 1c), never
 * the raw `state.message`: it can hold a path, a file name or a trace, none
 * of which may leave the machine.
 */
function classifyTtsError(message: string): "http" | "network" | "unknown" {
  if (/HTTP \d/.test(message)) return "http"
  if (/fetch|network/i.test(message)) return "network"
  return "unknown"
}
