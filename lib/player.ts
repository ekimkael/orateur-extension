/**
 * One reading, whatever the engine: the pill drives a `Player` and renders its
 * events, without knowing where the audio is made or where the position lives.
 *
 * The system voice speaks from the page (`lib/system-player.ts`); Supertonic
 * speaks from the TTS host behind the background (`lib/supertonic-player.ts`).
 */

import type { ReaderEngine, ReaderPreferences } from "./reader-prefs"
import type { PronunciationRule } from "./pronunciation/personal.ts"
import type { createLivePage } from "./live-page.ts"
import type { TtsLoadingReason, TtsPreparedBlock } from "./tts-messages"

export type ReadFailure = "synthesis" | "audio_playback" | "preparation"

export type PlayerEvent =
  | { phase: "loading"; reason?: TtsLoadingReason; progress?: number }
  /** Sound confirmed for paragraph `block`: fires again at every paragraph. */
  | { phase: "playing"; block: number; total: number }
  | { phase: "paused" }
  | { phase: "ended" }
  /**
   * `message` is meant for the user, when there is something to tell them.
   * A `recoverable` failure skips one paragraph; the reading goes on.
   */
  | { phase: "error"; reason: ReadFailure; message?: string; recoverable?: boolean }

export interface PlayerOptions {
  /** Paragraphs as written in the page, title announcement excluded. */
  paragraphs: string[]
  /** The whole extracted text the paragraphs come from. */
  text: string
  title: string
  startBlock: number
  personalRules: PronunciationRule[]
  /** Re-reads each paragraph from the live DOM (translated pages). */
  source: ReturnType<typeof createLivePage> | null
  /** Read at each use: a reading follows settings changed meanwhile. */
  prefs: () => ReaderPreferences
  emit: (event: PlayerEvent) => void
}

export interface Player {
  readonly engine: ReaderEngine
  start(): void
  pause(): void
  resume(): void
  seek(block: number): void
  /** Speed or voice changed while reading; `previous` holds the old values. */
  update(previous: ReaderPreferences): void
  /** Silences the engine, then `dispose()`. */
  stop(): void
  /** Ignores everything still in flight, without touching the engine. */
  dispose(): void
  /** Extension messages meant for this reading (TTS host events, block requests). */
  receive?(message: { type?: string }): Promise<TtsPreparedBlock | null> | void
}
