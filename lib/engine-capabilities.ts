import type { ReaderEngine } from "./reader-prefs.ts"

/** Shared product capabilities; runtime availability is checked separately. */
export const ENGINE_CAPABILITIES = {
  system: { pronunciation: true, requiresModel: false },
  supertonic: { pronunciation: true, requiresModel: true },
  pocket: { pronunciation: false, requiresModel: true },
} as const satisfies Record<ReaderEngine, { pronunciation: boolean; requiresModel: boolean }>
