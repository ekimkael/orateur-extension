/**
 * Supertonic, from the page's side: the TTS host (offscreen document on
 * Chrome, background page on Firefox) synthesizes, schedules and keeps the
 * position; this player only sends commands and translates the host's
 * `TTS_EVENT`s into `PlayerEvent`s.
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
  TTS_PREPARE_BLOCK,
  TTS_SEEK,
  TTS_SET_SPEED,
  TTS_SPEAK,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsPrepareBlockMessage,
  type TtsPreparedBlock,
  type TtsSeekMessage,
  type TtsSetSpeedMessage,
  type TtsSpeakMessage,
  type TtsState,
} from "./tts-messages.ts"
import type { Player, PlayerOptions } from "./player.ts"

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

  function control(action: TtsControlMessage["action"]) {
    void browser.runtime.sendMessage({ type: TTS_CONTROL, action } satisfies TtsControlMessage)
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
    if (!source || message.token !== token ||
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

  function dispose() {
    disposed = true
  }

  return {
    engine: "supertonic",
    start() {
      emit({ phase: "loading" })
      void browser.runtime.sendMessage({
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
      } satisfies Partial<TtsSpeakMessage>).catch(() => {
        if (!disposed) emit({ phase: "error", reason: "preparation" })
      })
    },
    pause() {
      paused = true
      control("pause")
    },
    resume() {
      paused = false
      control("resume")
    },
    seek(target) {
      block = target
      void browser.runtime.sendMessage({ type: TTS_SEEK, block: target, paused } satisfies TtsSeekMessage)
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
        void browser.runtime.sendMessage({ type: TTS_SET_SPEED, speed } satisfies TtsSetSpeedMessage)
      }
    },
    stop() {
      dispose()
      control("stop")
    },
    dispose,
    receive(message) {
      if (disposed) return
      if (message.type === TTS_EVENT) {
        const { state } = message as Partial<TtsEventMessage>
        if (state) onState(state)
      } else if (message.type === TTS_PREPARE_BLOCK) {
        return prepare(message as Partial<TtsPrepareBlockMessage>)
      }
    },
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
