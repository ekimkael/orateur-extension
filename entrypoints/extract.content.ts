import {
  extractArticle,
  extractGmailMessage,
  visibleText,
  type ExtractedArticle,
} from "../lib/extract-article"

export type ExtractResult =
  | { ok: true; article: ExtractedArticle }
  // `text`/`lang` : repli jalon 5 (Gmail, Substack, docs) — présents seulement
  // quand la page a assez de texte visible pour valoir la peine d'être lue.
  | { ok: false; error: string; text?: string; lang?: string }

export default defineContentScript({
  // Injecté à la demande par le background (permission activeTab), jamais
  // déclaré dans le manifest : pas de permission d'hôte large à justifier.
  registration: "runtime",
  // Sans ça, WXT produit une IIFE anonyme et executeScript ne récupère rien.
  globalName: "orateurExtract",
  main(): ExtractResult {
    // Gmail: the open message only. No visible-text fallback there — with no
    // message open it would read the whole app and the inbox.
    const gmail = location.hostname === "mail.google.com"
    try {
      return { ok: true, article: gmail ? extractGmailMessage(document) : extractArticle(document) }
    } catch (error) {
      if (gmail) return { ok: false, error: (error as Error).message }
      // Une exception ne traverse pas la frontière executeScript : on la
      // transporte dans la valeur de retour.
      const { text, lang } = visibleText(document)
      return {
        ok: false,
        error: (error as Error).message,
        text: text || undefined,
        lang: lang ?? undefined,
      }
    }
  },
})
