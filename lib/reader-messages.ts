/**
 * Messages and storage keys shared by the page reader and the background.
 * Kept out of the content script so `lib/` and the background never import
 * an entrypoint.
 */

export interface ReadPagePayload {
  text: string
  title?: string
  lang?: string
  livePage?: boolean
}

export interface StartReadingMessage extends ReadPagePayload {
  type: typeof START_READING
  fromHere?: boolean
}

export const START_READING = "orateur:start-reading"

/**
 * Demande d'extraction, envoyée au background au clic sur ▶.
 *
 * L'extraction reste là-bas : Readability ne doit pas entrer dans le bundle
 * d'un script chargé sur toutes les pages.
 */
export const READ_PAGE = "orateur:read-page"

/**
 * Signale un incident au background, seul contexte à pouvoir toucher le
 * badge de l'icône (`browser.action` n'existe pas dans un content script).
 */
export const NOTIFY = "orateur:notify"

export interface NotifyMessage {
  type: typeof NOTIFY
  message: string
}

/**
 * Clé de storage portant le jeton de l'onglet qui lit.
 *
 * `speechSynthesis` est partagé par tout le navigateur alors qu'il y a une
 * pastille par onglet : démarrer une lecture coupe celle d'à côté, dont la
 * pastille resterait dépliée sur une lecture morte. Chaque pastille inscrit
 * son jeton en prenant la parole, les autres le voient passer et se replient.
 *
 * Storage plutôt qu'un aiguillage par le background : rien à garder en mémoire
 * dans un service worker MV3 qui s'endort, et aucun onglet à recenser.
 *
 * Exportée : l'hôte Supertonic s'y abonne aussi, pour la même raison — sans
 * ça, un autre onglet qui prend la parole avec le moteur système laisserait
 * l'audio Supertonic tourner, sans plus aucune pastille pour l'arrêter.
 */
export const READER_TOKEN = "orateur:reading-tab"
