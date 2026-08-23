// lib/i18n.ts
//
// `browser.i18n.getMessage()` ne peut pas changer de langue à l'exécution —
// il suit la langue du navigateur, point (confirmé par la doc WXT elle-même :
// « the language cannot be changed without altering the browser/system
// language »). La section Général de la page d'options a besoin du contraire.
//
// Ce module lit les mêmes fichiers que browser.i18n — public/_locales/**
// reste l'unique catalogue, rien n'est dupliqué — mais via `fetch`, avec la
// langue choisie par l'utilisateur plutôt que celle du navigateur. Réservé
// aux pages de l'extension (options, futur popup) : le manifeste
// (`extName`, menus contextuels) n'a pas le choix et reste sur `__MSG_*__`.
import type { UiLanguage } from "./ui-prefs.ts"

/** Langue effectivement chargée — contrairement à `UiLanguage`, jamais "auto". */
export type Locale = "fr" | "en"

type Catalog = Record<string, { message: string }>

/** Résout "auto" sur la langue du navigateur ; "fr"/"en" passent tels quels. */
export function resolveLocale(language: UiLanguage): Locale {
  if (language !== "auto") return language
  return browser.i18n.getUILanguage().startsWith("fr") ? "fr" : "en"
}

const catalogs = new Map<Locale, Promise<Catalog>>()

function fetchCatalog(locale: Locale): Promise<Catalog> {
  const url = browser.runtime.getURL(`/_locales/${locale}/messages.json`)
  return fetch(url).then((res) => res.json())
}

export function loadCatalog(locale: Locale): Promise<Catalog> {
  let promise = catalogs.get(locale)
  if (!promise) {
    promise = fetchCatalog(locale)
    catalogs.set(locale, promise)
  }
  return promise
}

/**
 * Même comportement positionnel que `browser.i18n.getMessage` quand le
 * message ne déclare pas de `placeholders` : `$1`, `$2`… remplacés dans
 * l'ordre, sans dictionnaire nommé — les messages.json du dépôt n'en
 * définissent aucun.
 */
export function substitute(message: string, subs?: string[]): string {
  if (!subs?.length) return message
  return subs.reduce((acc, sub, i) => acc.replaceAll(`$${i + 1}`, sub), message)
}

export function translate(catalog: Catalog, key: string, subs?: string[]): string {
  const entry = catalog[key]
  if (!entry) return key
  return substitute(entry.message, subs)
}
