// ponytail: le web n'a pas encore de domaine prod (cf. web/app/lib/seo.ts, siteUrl = "").
// Le jour où il existe, c'est la seule ligne à changer.
const ORATEUR_ORIGIN = "http://localhost:5173"

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
  url: string
  lang?: string | null
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
