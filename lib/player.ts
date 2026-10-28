/**
 * One reading, whatever the engine: the pill drives a `Player` and renders its
 * events, without knowing where the audio is made or where the position lives.
 *
 * The system voice speaks from the page (`lib/system-player.ts`); Supertonic
 * speaks from the TTS host, reached over its own port (`lib/supertonic-player.ts`).
 * See docs/reading-architecture.md.
 */

import type { ReaderEngine, ReaderPreferences } from "./reader-prefs"
import type { PronunciationRule } from "./pronunciation/personal.ts"
import type { createLivePage } from "./live-page.ts"
import type { TtsLoadingReason } from "./tts-messages"

/** Why a reading failed, as counted by telemetry (`read_failed`). */
export type ReadFailure = "synthesis" | "audio_playback" | "preparation"

/** What an engine reports to the session, in the order it happens. */
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

/** What both engines need to read one article. */
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

/** One reading on one engine; created per reading, never reused. */
export interface Player {
  readonly engine: ReaderEngine
  /** Starts at `startBlock`. Events may follow synchronously. */
  start(): void
  pause(): void
  /** Resumes, applying any speed or voice change made while paused. */
  resume(): void
  /** Jumps to the start of paragraph `block`, keeping the paused state. */
  seek(block: number): void
  /** Speed or voice changed while reading; `previous` holds the old values. */
  update(previous: ReaderPreferences): void
  /** Silences the engine, then `dispose()`. */
  stop(): void
  /**
   * Ignores everything still in flight. The page's voice is left alone (it
   * may already belong to another tab); Supertonic closes its port, which
   * releases the host.
   */
  dispose(): void
}
