const ORATEUR_ORIGIN = "https://orateur.digitalekim.net"

/**
 * Une page est transférable si Orateur peut la refetcher côté serveur.
 *
 * /api/import-article n'accepte que http/https : tout le reste (chrome://,
 * about:, file://, chrome-extension://, view-source:) produirait une erreur
 * après coup, donc on filtre avant d'ouvrir un onglet pour rien.
 */
export function isSavable(url: string | undefined): url is string {
  if (!url) return false
  try {
    return ["http:", "https:"].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Construit l'URL de repli : Orateur refetche et reparse la page lui-même.
 *
 * S'appuie sur le partage déjà implémenté dans web/app/routes/add.tsx :
 * `extractSharedUrl` lit `?url=`, `importFromUrl` déclenche l'import
 * automatiquement, et `?title=` sert de titre de repli.
 */
export function buildHandoffUrl(pageUrl: string, title?: string) {
  const params = new URLSearchParams({ url: pageUrl })
  if (title?.trim()) params.set("title", title.trim())
  return `${ORATEUR_ORIGIN}/articles/new?${params}`
}

/** Ce que `readExtensionImport` sait lire côté web. */
export interface HandoffPayload {
  content: string
  title?: string | null
  /** Absente pour une sélection sur une page non transférable (file://, PDF). */
  url?: string
  lang?: string | null
}

/**
 * Convertit du texte brut en paragraphes HTML, entités échappées.
 *
 * Côté web, `createStoredArticleFromImport` interprète `content` comme du HTML
 * dès qu'il y repère du balisage : une sélection contenant `<div>` serait
 * avalée telle quelle. L'échappement rend le trajet réversible et garantit
 * qu'aucun fragment de la page sélectionnée ne revient comme du balisage — la
 * sélection est une donnée non fiable, jamais du HTML.
 *
 * Seuls `&`, `<` et `>` sont échappés : c'est tout ce qui compte dans un nœud
 * texte, les guillemets n'y ouvrent pas d'attribut.
 */
export function textToParagraphHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p>${block
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`
    )
    .join("")
}

/**
 * Construit l'URL de transfert du contenu déjà extrait.
 *
 * Le payload voyage dans le fragment, jamais dans la query : `/articles/new`
 * est une vraie route serveur, et un article complet en `?text=` dépasserait la
 * limite d'en-tête HTTP de Node. Le fragment n'est pas envoyé au serveur.
 */
export function buildImportUrl(payload: HandoffPayload) {
  const encoded = encodeURIComponent(JSON.stringify(payload))
  return `${ORATEUR_ORIGIN}/articles/new#orateur=${encoded}`
}
