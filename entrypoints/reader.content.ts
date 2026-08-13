/**
 * Lecture de l'article directement sur la page, via la synthèse vocale native
 * du navigateur (`speechSynthesis`) — pas d'appel réseau, pas de dépendance.
 *
 * La pastille est posée sur toutes les pages, repliée sur un bouton ▶ tant
 * qu'aucune lecture n'est en cours : c'est ce qui permet de lancer la lecture
 * sans passer par le menu contextuel. Elle se déplie en barre pause/stop
 * pendant la lecture.
 */

export interface ReadPagePayload {
  text: string
  title?: string
  lang?: string
}

export interface StartReadingMessage extends ReadPagePayload {
  type: typeof START_READING
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
 * Clé de storage portant le jeton de l'onglet qui lit.
 *
 * `speechSynthesis` est partagé par tout le navigateur alors qu'il y a une
 * pastille par onglet : démarrer une lecture coupe celle d'à côté, dont la
 * pastille resterait dépliée sur une lecture morte. Chaque pastille inscrit
 * son jeton en prenant la parole, les autres le voient passer et se replient.
 *
 * Storage plutôt qu'un aiguillage par le background : rien à garder en mémoire
 * dans un service worker MV3 qui s'endort, et aucun onglet à recenser.
 */
const READER_TOKEN = "orateur:reading-tab"

type PillState = "idle" | "loading" | "playing" | "paused"

export default defineContentScript({
  // Déclaré dans le manifest, contrairement à l'extracteur : la pastille doit
  // déjà être là avant le geste de l'utilisateur. Aucun avertissement de plus,
  // la bulle de sélection réclame déjà <all_urls>.
  matches: ["<all_urls>"],
  // Pas d'`allFrames` (défaut : frame principale) : une pastille par page, là
  // où la bulle de sélection en veut une par iframe.
  main(ctx) {
    let reading = false
    let paused = false
    const token = Math.random().toString(36).slice(2)

    const pill = createPill(onPrimary, onSecondary)

    browser.runtime.onMessage.addListener(onMessage)
    browser.storage.onChanged.addListener(onTokenChanged)
    // La synthèse survit au déchargement de la page : sans ça la lecture
    // continue après un rechargement, hors de portée de la nouvelle pastille.
    ctx.addEventListener(window, "pagehide", () => reading && cancelSpeech())
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.storage.onChanged.removeListener(onTokenChanged)
      cancelSpeech()
      pill.remove()
    })

    function onMessage(message: Partial<StartReadingMessage>) {
      if (message?.type !== START_READING || !message.text) return
      start(message as ReadPagePayload)
    }

    /** Un autre onglet a pris la parole : se replier, sans toucher au moteur. */
    function onTokenChanged(changes: Record<string, { newValue?: unknown }>) {
      const owner = changes[READER_TOKEN]?.newValue
      if (owner === undefined || owner === token || !reading) return
      fold()
    }

    /** ▶ lance la lecture, ⏸/▶ la met en pause et la reprend. */
    async function onPrimary() {
      if (reading) {
        // Notre propre drapeau, jamais `speechSynthesis.paused` : Chrome ne met
        // le sien à jour qu'après coup, on relirait l'état d'avant le clic.
        paused = !paused
        if (paused) speechSynthesis.pause()
        else speechSynthesis.resume()
        pill.setState(paused ? "paused" : "playing")
        return
      }

      pill.setState("loading")
      // Un rejet (background endormi, onglet non injectable) vaut un échec :
      // sans ça la pastille resterait bloquée sur son état d'attente.
      const started = await browser.runtime
        .sendMessage({ type: READ_PAGE })
        .catch(() => false)
      // La réponse peut arriver après START_READING : ne redescendre à l'état
      // replié que si rien n'a démarré.
      if (!started && !reading) pill.setState("idle")
    }

    /** ⏹ pendant la lecture, ✕ au repos : masquer jusqu'au rechargement. */
    function onSecondary() {
      if (reading) stop()
      else pill.remove()
    }

    function start(payload: ReadPagePayload) {
      cancelSpeech()
      const queue = toUtterances(payload)
      if (!queue.length) return fold()

      reading = true
      paused = false
      // Prendre la parole : les pastilles des autres onglets s'en déduisent.
      void browser.storage.local.set({ [READER_TOKEN]: token })
      // La pastille a pu être masquée : une lecture lancée depuis le menu
      // contextuel doit quand même offrir de quoi l'arrêter.
      pill.attach()
      pill.setState("playing", payload.title ?? "")

      // Se replier sans annuler : la file est déjà vide en fin naturelle, et si
      // l'événement vient d'un autre onglet qui nous a coupés, annuler ici
      // tuerait *sa* lecture.
      //
      // ponytail: la fin n'est détectée que sur le dernier bloc — si celui-ci
      // erre au lieu de finir, la pastille reste dépliée jusqu'au clic sur ⏹.
      queue.at(-1)?.addEventListener("end", fold)
      for (const utterance of queue) speechSynthesis.speak(utterance)
    }

    /** ⏹ : couper le moteur, puis se replier. */
    function stop() {
      fold()
      cancelSpeech()
    }

    /** Revenir au repos sans toucher au moteur de synthèse. */
    function fold() {
      reading = false
      paused = false
      pill.setState("idle")
    }
  },
})

/**
 * Annule la synthèse en cours.
 *
 * Chrome garde sa file quand on annule une lecture en pause : elle repart au
 * `speak()` suivant. Reprendre avant d'annuler la vide pour de bon.
 */
function cancelSpeech() {
  speechSynthesis.resume()
  speechSynthesis.cancel()
}

/** Un utterance par bloc, pour éviter la limite de longueur de Chrome. */
function toUtterances(payload: ReadPagePayload) {
  return payload.text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const utterance = new SpeechSynthesisUtterance(block)
      if (payload.lang) utterance.lang = payload.lang
      return utterance
    })
}

const HOST_STYLE =
  "all:initial!important;position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important"

const PILL_CSS = `
div {
  display: inline-flex;
  align-items: center;
  padding: 6px;
  border-radius: 999px;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  background: #111827;
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.28);
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}
button:hover:not(:disabled) { background: rgb(255 255 255 / 0.12) }
button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px }
button:disabled { opacity: 0.55; cursor: default }
/*
 * Au repos la pastille se replie sur ses deux boutons : le titre garde son
 * texte mais tombe à une largeur nulle. Une largeur n'a pas d'équivalent en
 * transform — même exception que pour un accordéon.
 */
span {
  max-width: 0;
  margin: 0;
  opacity: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    max-width 200ms cubic-bezier(0.23, 1, 0.32, 1),
    margin 200ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
:host([data-expanded]) span {
  max-width: 220px;
  margin: 0 6px;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  span { transition: opacity 120ms ease-out }
}
`

/** Libellé et intitulé accessible de chaque bouton, état par état. */
const LABELS: Record<PillState, { primary: string; secondary: string }> = {
  idle: { primary: "▶", secondary: "✕" },
  loading: { primary: "…", secondary: "✕" },
  playing: { primary: "⏸", secondary: "⏹" },
  paused: { primary: "▶", secondary: "⏹" },
}

const ARIA: Record<PillState, { primary: string; secondary: string }> = {
  idle: { primary: "Lire cette page avec Orateur", secondary: "Masquer Orateur sur cette page" },
  loading: { primary: "Extraction de l'article…", secondary: "Masquer Orateur sur cette page" },
  playing: { primary: "Mettre en pause", secondary: "Arrêter la lecture" },
  paused: { primary: "Reprendre la lecture", secondary: "Arrêter la lecture" },
}

/**
 * Pastille flottante, dans un shadow root fermé — même isolation que la bulle
 * de sélection, pour les mêmes raisons.
 */
function createPill(onPrimary: () => void, onSecondary: () => void) {
  const host = document.createElement("orateur-reader-pill")
  host.style.cssText = HOST_STYLE

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = PILL_CSS
  root.append(style)

  const row = document.createElement("div")
  const primary = button(onPrimary)
  const label = document.createElement("span")
  const secondary = button(onSecondary)
  row.append(primary, label, secondary)
  root.append(row)

  function attach() {
    // `body` est absent d'un document XML ou SVG.
    if (!host.isConnected) (document.body ?? document.documentElement).append(host)
  }

  attach()
  setState("idle")

  function setState(state: PillState, title?: string) {
    primary.textContent = LABELS[state].primary
    primary.setAttribute("aria-label", ARIA[state].primary)
    secondary.textContent = LABELS[state].secondary
    secondary.setAttribute("aria-label", ARIA[state].secondary)
    // Rien à annuler tant que l'extraction tourne : quelques centaines de
    // millisecondes, plus simple à neutraliser qu'à interrompre.
    primary.disabled = secondary.disabled = state === "loading"
    // Le titre n'est réécrit que quand on en fournit un : une pause ne doit
    // pas le perdre — donc pas replier la pastille — juste changer l'icône.
    if (title !== undefined) label.textContent = title
    host.toggleAttribute("data-expanded", state === "playing" || state === "paused")
  }

  return { attach, setState, remove: () => host.remove() }
}

function button(onClick: () => void) {
  const element = document.createElement("button")
  element.type = "button"
  // Le mousedown par défaut déplace le caret et efface une sélection en cours.
  element.addEventListener("mousedown", (event) => event.preventDefault())
  element.addEventListener("click", onClick)
  return element
}
