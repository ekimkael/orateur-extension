/**
 * What the voice says once an article ends: a thanks every time, and an
 * invitation to support Orateur every `SUPPORT_CADENCE` completed articles.
 *
 * The phrases follow the reading's language, not the interface's: the outro
 * is spoken by the article's own voice, and a Supertonic English voice cannot
 * read French. Same wording as the web app's outro (`web/app/lib/reading-outro.ts`)
 * for the thanks; the support ask is the extension's own.
 */

/** The support ask comes with the 1st, then every 3rd completed article. */
export const SUPPORT_CADENCE = 3

/** Donation page, the same as the web app's `SUPPORT_URL`. */
export const SUPPORT_URL = "https://bikiekrb.mychariow.online/prd_bs2lca7z/checkout"

const COMPLETED_COUNT_KEY = "orateur:completed-articles"

const OUTRO_BY_LANGUAGE: Record<string, { thanks: string; support: string }> = {
  fr: {
    thanks: "Fin de l'article, merci d'avoir écouté.",
    support: "Orateur est développé par une seule personne. Si cette lecture vous a été utile, un petit don m'aide à continuer. Le lien est juste à côté.",
  },
  en: {
    thanks: "End of the article, thank you for listening.",
    support: "Orateur is built by one person. If this reading was useful, a small donation helps me keep going. The link is right there.",
  },
}

/**
 * Builds the outro for the `completedCount`-th completed article (0-based).
 * `speech` is empty for a language without phrases; `support` follows the
 * cadence whatever the language, so the pill can still show its link.
 */
export function buildReadingOutro(lang: string | null, completedCount: number): { speech: string; support: boolean } {
  const support = completedCount % SUPPORT_CADENCE === 0
  const phrases = lang ? OUTRO_BY_LANGUAGE[lang] : undefined
  if (!phrases) return { speech: "", support }
  return { speech: support ? `${phrases.thanks} ${phrases.support}` : phrases.thanks, support }
}

/**
 * Returns how many articles were completed before this one and counts this
 * one. Unavailable storage counts as 0, which includes the support ask.
 */
export async function nextCompletedCount(): Promise<number> {
  try {
    const count = Number((await browser.storage.local.get(COMPLETED_COUNT_KEY))[COMPLETED_COUNT_KEY]) || 0
    await browser.storage.local.set({ [COMPLETED_COUNT_KEY]: count + 1 })
    return count
  } catch {
    return 0
  }
}
