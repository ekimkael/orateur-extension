/**
 * Supertonic, from the page's side: the TTS host (offscreen document on
 * Chrome, background page on Firefox) synthesizes, schedules and keeps the
 * position; this player opens its own port to it (`lib/tts-port.ts`), sends
 * commands and translates the host's `TTS_EVENT`s into `PlayerEvent`s.
 *
 * Value imports stay out of `lib/supertonic/*`: they would pull the engine
 * into the bundle of a script loaded on every page.
 */

import { buildReadingIntro } from "./reading-intro.ts"
import { resolveBlockLangs } from "./reading-language.ts"
import { detectLang, resolveDocLang } from "./detect-lang.ts"
import { toSupertonicLang, type SupportedLang } from "./supertonic-lang.ts"
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
  const { paragraphs, text, title, lang, startBlock, personalRules, source, token, prefs, emit } = options

  // `lang` est la langue résolue (déclaration ou détection), pas
  // forcément celle de la page : l'annonce du titre doit sonner dans la
  // langue qui va réellement être lue.
  //
  // Même annonce de titre qu'en système (buildReadingIntro), composée ici
  // plutôt que par l'hôte : lib/tts-host.ts ne connaît ni onglets ni titres,
  // seulement du texte à synthétiser.
  const intro = buildReadingIntro(lang, title)
  // Same per-block languages as the host computes: a block re-prepared
  // from the live page falls back on them, not on the page declaration.
  const blockLangs = resolveBlockLangs(paragraphs, lang)
  let block = startBlock
  let paused = false
  let disposed = false
  /**
   * Vrai dès qu'un `reason: "downloading-model"` est vu pendant cette
   * lecture — sert à ne compter `supertonic_download_completed`/`_failed`
   * (télémétrie, jalon 1c) que quand un téléchargement a vraiment eu lieu,
   * pas à chaque lecture qui trouve le modèle déjà en cache.
   */
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
        emit({ phase: "error", reason: "preparation", message: browser.i18n.getMessage("errorSupertonicStartFailed") })
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
      // Télémétrie (jalon 1c) : une seule fois par lecture, au tout premier
      // "downloading-model" — les ticks de progression suivants repassent
      // par cette même branche sans redéclencher l'événement.
      if (state.reason === "downloading-model" && !sawDownload) {
        sawDownload = true
        track({ name: "supertonic_download_started" })
      }
      emit({ phase: "loading", reason: state.reason, progress: state.progress })
    } else if (state.phase === "playing") {
      paused = false
      block = state.block
      emit({ phase: "playing", block: state.block, total: state.total })
      if (sawDownload) {
        sawDownload = false
        track({ name: "supertonic_download_completed" })
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
        // `state.message` d'une exception (ONNX, réseau) n'a rien de
        // traduisible ; seule l'erreur audio statique de tts-host.ts l'est.
        message: audio ? browser.i18n.getMessage("ttsAudioError") : state.message,
      })
      if (sawDownload) {
        sawDownload = false
        track({ name: "supertonic_download_failed", properties: { reason: classifyTtsError(state.message) } })
      }
    }
  }

  function prepare(message: Partial<TtsPrepareBlockMessage>): Promise<TtsPreparedBlock | null> {
    const index = message.block!
    if (!source || !Number.isInteger(message.id) ||
      !Number.isInteger(index) || index < 0 || index >= paragraphs.length ||
      (message.prefetch !== undefined && typeof message.prefetch !== "boolean")) return Promise.resolve(null)
    return source.prepare(index, prefs().follow, !!message.prefetch, index > block ? "nearest" : "center").then((text): TtsPreparedBlock | null => {
      if (disposed) return null
      // A short block decides nothing alone: Gmail's French declaration
      // would win over the English message the start already resolved.
      const resolved = toSupertonicLang(blockLangs[index] ?? "")
      const lang = (resolved ? detectLang(text, resolved) : resolveDocLang(document.documentElement.lang, text)) ?? "na"
      return { text: index === 0 && intro ? `${intro} ${text}` : text, lang }
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
    engine: "supertonic",
    start() {
      emit({ phase: "loading" })
      connection = open()
      send({
        type: TTS_SPEAK,
        // Sur le texte de la page, l'annonce du titre n'y est écrite nulle
        // part : l'hôte la recolle au premier paragraphe (`splitBlocks`),
        // donc les index concordent quand même.
        text: intro ? `${intro} ${text}` : text,
        title,
        lang,
        voice: prefs().supertonicVoice,
        speed: prefs().speed,
        startBlock,
        personalRules,
        token,
        livePage: !!source,
      })
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
      // La vitesse s'applique tout de suite (audio.playbackRate, jamais de
      // resynthèse) : aucune raison d'attendre la reprise, contrairement au
      // moteur système.
      //
      // ponytail: un changement de voix Supertonic en cours de lecture
      // n'est pas repris à la volée — l'hôte ne garde pas de position dans
      // le texte pour relancer avec une autre voix. Arrêter puis relire
      // pour l'entendre.
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
 * Classe grossièrement une erreur de téléchargement pour la télémétrie
 * (jalon 1c) — jamais le texte brut de `state.message` : il peut contenir un
 * chemin, un nom de fichier, une trace, rien de destiné à quitter la machine.
 */
function classifyTtsError(message: string): "http" | "network" | "unknown" {
  if (/HTTP \d/.test(message)) return "http"
  if (/fetch|network/i.test(message)) return "network"
  return "unknown"
}
