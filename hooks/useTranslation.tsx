import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { loadCatalog, resolveLocale, translate } from "../lib/i18n"
import type { UiLanguage } from "../lib/ui-prefs"

type Catalog = Awaited<ReturnType<typeof loadCatalog>>
type Translate = (key: string, subs?: string[]) => string

const TranslationContext = createContext<Translate | null>(null)

/**
 * Pont vers lib/i18n.ts : charge le catalogue de la langue choisie et expose
 * `t()` au sous-arbre. Sépare de `useUiPrefs` : cette page a besoin de la
 * préférence *résolue* en locale concrète, pas de la préférence brute
 * ("auto" n'est pas une langue à charger).
 */
export function TranslationProvider({ language, children }: { language: UiLanguage; children: ReactNode }) {
  const locale = resolveLocale(language)
  const [catalog, setCatalog] = useState<Catalog | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadCatalog(locale).then((loaded) => {
      if (!cancelled) setCatalog(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  // Premier chargement, avant que le fetch de _locales/**/messages.json ne
  // résolve — quelques millisecondes, même choix que useReaderPrefs pour le
  // premier rendu de App.tsx.
  if (!catalog) return null

  const t: Translate = (key, subs) => translate(catalog, key, subs)
  return <TranslationContext.Provider value={t}>{children}</TranslationContext.Provider>
}

export function useTranslation(): Translate {
  const t = useContext(TranslationContext)
  if (!t) throw new Error("useTranslation must be used within a TranslationProvider")
  return t
}
