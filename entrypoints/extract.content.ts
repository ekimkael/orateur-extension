import { extractArticle, type ExtractedArticle } from "../lib/extract-article"

export type ExtractResult =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; error: string }

export default defineContentScript({
  // Injecté à la demande par le background (permission activeTab), jamais
  // déclaré dans le manifest : pas de permission d'hôte large à justifier.
  registration: "runtime",
  // Sans ça, WXT produit une IIFE anonyme et executeScript ne récupère rien.
  globalName: "orateurExtract",
  main(): ExtractResult {
    try {
      return { ok: true, article: extractArticle(document) }
    } catch (error) {
      // Une exception ne traverse pas la frontière executeScript : on la
      // transporte dans la valeur de retour.
      return { ok: false, error: (error as Error).message }
    }
  },
})
