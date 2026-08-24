import { useEffect, useState } from "react"
import { loadHiddenSites, addHiddenSite, removeHiddenSite, onHiddenSitesChanged } from "../lib/site-rules"

/**
 * Même forme que useUiPrefs.ts, avec une différence : la valeur par défaut
 * est une liste vide directement utilisable, pas `null` — rien à gagner à
 * faire attendre toute la page d'options pour une section annexe.
 *
 * `add`/`remove` ne mettent pas à jour `sites` elles-mêmes : l'abonnement à
 * onHiddenSitesChanged s'en charge, déjà passé par sanitize() (dédoublonné,
 * trié) — dupliquer cette logique ici pour un gain d'un tick n'en vaut pas
 * la peine.
 */
export function useHiddenSites() {
  const [sites, setSites] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void loadHiddenSites().then((loaded) => {
      if (!cancelled) setSites(loaded)
    })
    const unsubscribe = onHiddenSitesChanged((updated) => {
      if (!cancelled) setSites(updated)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return {
    sites,
    add: (input: string) => void addHiddenSite(input),
    remove: (site: string) => void removeHiddenSite(site),
  }
}
