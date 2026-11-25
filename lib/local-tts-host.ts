import type { TtsControlAction, TtsPreparedBlock } from "./tts-messages.ts"

/** Commands shared by local engines; synthesis and scheduling stay model-specific. */
export interface LocalTtsHost<Request> {
  speak(request: Request): void
  control(action: TtsControlAction): void
  seek(block: number, paused: boolean): void
  setSpeed(speed: number): void
  /** Releases the model when another engine takes over. */
  dispose?(): void
}

/** Pocket and Kale receive speech-ready paragraphs in one model language. */
export interface ChunkedSpeakRequest {
  paragraphs: readonly TtsPreparedBlock<string>[]
  lang: string
  voice: string
  speed: number
  startBlock?: number
  /** Read verified cached model files and fail when any are missing. */
  cacheOnly?: boolean
  /** Try Kale's GPU graph before the CPU fallback. */
  webGpu?: boolean
  /** Refresh DOM text before synthesis; a removed paragraph resolves to null. */
  prepareParagraph?: (paragraph: number, prefetch?: boolean) => Promise<TtsPreparedBlock<string> | null>
}
