// lib/site-rules.ts
//
// Domaines où Orateur ne doit rien afficher — ni pastille, ni bulle de
// sélection. Liste d'exclusion seule : visible partout par défaut, la liste
// dit seulement où se taire.
//
// Importé par reader.content.ts et selection.content.ts, qui tournent sur
// `<all_urls>` : zéro dépendance, zéro React, comme reader-prefs.ts.

const SITES_KEY = "orateur:hidden-sites"

/**
 * Ce que l'utilisateur colle → le domaine à stocker.
 *
 * `https://www.youtube.com/watch?v=x`, `www.youtube.com` et `youtube.com`
 * donnent tous `youtube.com` : le `www.` en tête part parce que `isHidden`
 * matche déjà les sous-domaines, et le garder ferait rater le domaine nu.
 * `null` sur une entrée qui n'a pas d'hôte — le bouton Ajouter s'en sert
 * pour rester inerte.
 */
export function normalizeSite(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    // Le préfixe de secours rend `URL` utilisable sur une saisie nue ; il ne
    // s'applique qu'à ce qui n'annonce pas déjà son schéma.
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    const host = url.hostname.toLowerCase()
    // `URL` accepte "!!!" comme chemin relatif d'un hôte vide, et tolère un
    // hôte sans point : ni l'un ni l'autre n'est un site à exclure.
    if (!host || !host.includes(".")) return null
    return host.startsWith("www.") ? host.slice(4) : host
  } catch {
    return null
  }
}

/**
 * Sous-domaines inclus : `youtube.com` couvre `m.youtube.com`.
 *
 * Le point compte — sans lui, `notyoutube.com` matcherait `youtube.com`.
 */
export function isHidden(hostname: string, sites: string[]): boolean {
  const host = hostname.toLowerCase()
  return sites.some((site) => host === site || host.endsWith(`.${site}`))
}

// Le storage n'est pas une source sûre : une édition manuelle ou une version
// précédente peut y laisser autre chose qu'un tableau de domaines propres.
function sanitize(sites: unknown): string[] {
  if (!Array.isArray(sites)) return []
  const clean = sites.flatMap((site) => {
    if (typeof site !== "string") return []
    const normalized = normalizeSite(site)
    return normalized ? [normalized] : []
  })
  return [...new Set(clean)].sort()
}

export async function loadHiddenSites(): Promise<string[]> {
  const data = await browser.storage.local.get(SITES_KEY)
  return sanitize(data[SITES_KEY])
}

async function save(sites: string[]) {
  await browser.storage.local.set({ [SITES_KEY]: sanitize(sites) })
}

/** Sans effet si le domaine est déjà couvert — `sanitize` dédoublonne. */
export async function addHiddenSite(input: string): Promise<void> {
  const site = normalizeSite(input)
  if (!site) return
  // Le `get` doit être attendu : sans ça deux ajouts coup sur coup relisent
  // tous les deux la liste d'avant, et le second écrase le premier.
  const current = await loadHiddenSites()
  await save([...current, site])
}

export async function removeHiddenSite(site: string): Promise<void> {
  const current = await loadHiddenSites()
  await save(current.filter((entry) => entry !== site))
}

export function onHiddenSitesChanged(callback: (sites: string[]) => void) {
  const handler = (changes: Record<string, any>) => {
    if (SITES_KEY in changes) callback(sanitize(changes[SITES_KEY].newValue))
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}
