/**
 * Lecture de l'article directement sur la page, via la synthèse vocale native
 * du navigateur (`speechSynthesis`) — pas d'appel réseau, pas de dépendance.
 *
 * La pastille est posée sur toutes les pages, repliée sur un bouton ▶ tant
 * qu'aucune lecture n'est en cours : c'est ce qui permet de lancer la lecture
 * sans passer par le menu contextuel. Elle se déplie en barre pause/stop
 * pendant la lecture.
 */

import {
  loadPrefs,
  savePrefs,
  onPrefsChanged,
  SPEED,
  type ReaderEngine,
  type ReaderPreferences,
} from "../lib/reader-prefs"
import { expandText } from "../lib/pronunciation/index.ts"
import { buildReadingIntro } from "../lib/reading-intro"

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
  async main(ctx) {
    let reading = false
    let paused = false
    /** Position de lecture : le bloc en cours, et où la voix en est dedans. */
    let blocks: string[] = []
    let blockIndex = 0
    let charIndex = 0
    let lang: string | undefined
    /**
     * Numéro de la file en cours.
     *
     * Relancer la lecture passe par `cancel()`, qui fait remonter un `end` sur
     * l'utterance coupée — indistinguable d'une fin naturelle. Chaque file
     * garde le numéro qu'elle avait à sa création : celle qui n'est plus la
     * courante sait que son `end` est un contrecoup et ne replie pas la
     * pastille.
     */
    let generation = 0
    /** Un réglage a changé pendant la pause : à appliquer à la reprise. */
    let stale = false
    const token = Math.random().toString(36).slice(2)
    // Réassigné, pas figé : une lecture doit partir sur les réglages du moment,
    // y compris ceux changés depuis un autre onglet.
    let prefs = await loadPrefs()

    const pill = createPill(onPrimary, onSecondary, prefs)

    browser.runtime.onMessage.addListener(onMessage)
    browser.storage.onChanged.addListener(onTokenChanged)
    const unsubscribePrefs = onPrefsChanged((newPrefs) => {
      const affectsVoice =
        newPrefs.speed !== prefs.speed || newPrefs.voiceURI !== prefs.voiceURI
      prefs = newPrefs
      pill.updatePrefs(newPrefs)
      if (!affectsVoice || !reading) return
      // La synthèse ne réaccorde pas un utterance déjà lancé : le seul moyen
      // d'entendre la nouvelle vitesse est de refaire la file à partir du mot
      // en cours. En pause, on attend la reprise plutôt que de repartir tout
      // seul — `cancel()` déferait la pause.
      if (paused) stale = true
      else speak()
    })
    // La synthèse survit au déchargement de la page : sans ça la lecture
    // continue après un rechargement, hors de portée de la nouvelle pastille.
    ctx.addEventListener(window, "pagehide", () => reading && cancelSpeech())
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.storage.onChanged.removeListener(onTokenChanged)
      unsubscribePrefs()
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
        // La file en attente porte encore l'ancienne vitesse : la refaire plutôt
        // que la reprendre, sinon le réglage change au bloc suivant seulement.
        else if (stale) {
          stale = false
          speak()
        } else speechSynthesis.resume()
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
      // Un bloc par paragraphe, pour éviter la limite de longueur de Chrome.
      // Le découpage passe avant `expandText`, qui écrase les blancs — les
      // frontières de paragraphes n'y survivraient pas.
      const raw = payload.text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)

      // Le titre n'est pas dans le texte extrait — Readability retire le h1 qui
      // le répète. L'annoncer en tête du premier bloc plutôt qu'en bloc à part :
      // il suit alors la même reprise que le reste, comme sur mobile.
      const intro = buildReadingIntro(payload.lang ?? "", payload.title ?? "")
      if (intro && raw.length) raw[0] = `${intro} ${raw[0]}`

      // Texte à dire, jamais à afficher : sigles épelés, symboles verbalisés,
      // anglicismes réécrits pour les voix système. Ce sont les seules
      // disponibles ici, donc la couche phonétique s'applique toujours.
      blocks = raw.map((block) => expandText(block, { language: payload.lang })).filter(Boolean)
      if (!blocks.length) return fold()

      blockIndex = 0
      charIndex = 0
      lang = payload.lang
      reading = true
      paused = false
      stale = false
      // Prendre la parole : les pastilles des autres onglets s'en déduisent.
      void browser.storage.local.set({ [READER_TOKEN]: token })
      // La pastille a pu être masquée : une lecture lancée depuis le menu
      // contextuel doit quand même offrir de quoi l'arrêter.
      pill.attach()
      pill.setState("playing", payload.title ?? "")
      speak()
    }

    /**
     * Met en file ce qu'il reste à lire, aux réglages du moment.
     *
     * Appelée au démarrage comme à chaque changement de vitesse ou de voix :
     * dans les deux cas on repart de `blockIndex`/`charIndex`, donc du mot où
     * la voix en était.
     */
    function speak() {
      const mine = ++generation
      cancelSpeech()

      // Résolue une fois pour toute la file : `getVoices()` reconstruit sa
      // liste à chaque appel. Introuvable (voix désinstallée, autre machine)
      // vaut défaut.
      const voice = prefs.voiceURI
        ? speechSynthesis.getVoices().find((v) => v.voiceURI === prefs.voiceURI)
        : undefined

      const queue = blocks.slice(blockIndex).map((block, offset) => {
        // Seul le premier bloc reprend en cours de route ; les suivants sont
        // entiers, et leurs positions repartent donc de zéro.
        const from = offset === 0 ? charIndex : 0
        const at = blockIndex + offset
        const utterance = new SpeechSynthesisUtterance(block.slice(from))
        if (lang) utterance.lang = lang
        utterance.rate = prefs.speed
        if (voice) utterance.voice = voice

        utterance.addEventListener("start", () => {
          blockIndex = at
          charIndex = from
        })
        // `charIndex` est compté depuis le début de l'utterance, donc depuis le
        // reste du bloc : le rebaser sur le bloc entier, sinon une deuxième
        // reprise repartirait trop tôt.
        //
        // ponytail: les voix distantes n'émettent pas toujours `boundary`. Sans
        // lui la position reste au dernier départ, et changer la vitesse fait
        // reprendre le bloc courant depuis là — jamais plus loin que ça.
        utterance.addEventListener("boundary", (event) => {
          charIndex = from + event.charIndex
        })
        return utterance
      })

      // Se replier sans annuler : la file est déjà vide en fin naturelle, et si
      // l'événement vient d'un autre onglet qui nous a coupés, annuler ici
      // tuerait *sa* lecture.
      //
      // ponytail: la fin n'est détectée que sur le dernier bloc — si celui-ci
      // erre au lieu de finir, la pastille reste dépliée jusqu'au clic sur ⏹.
      queue.at(-1)?.addEventListener("end", () => {
        if (mine === generation) fold()
      })
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
      stale = false
      // La file coupée ne nous appartient plus : un `end` en retard ne doit pas
      // replier une lecture relancée entre-temps.
      generation++
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

const HOST_STYLE =
  "all:initial!important;position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important"

const PILL_CSS = `
.pill-row {
  /*
   * Palette posée ici et pas sur :host — le HOST_STYLE inline porte un
   * all:initial!important qui écraserait tout ce qu'on y déclarerait.
   * Le popover en hérite : une seule matière pour les deux.
   */
  --bg: #111827;
  --fg: #fff;
  --muted: #9ca3af;
  --line: rgb(255 255 255 / 0.14);
  --accent: #60a5fa;
  /* Fait rendre le menu déroulant natif du select et le curseur en sombre.
     Deux propriétés au lieu d'un select réimplémenté. */
  color-scheme: dark;
  accent-color: var(--accent);

  display: inline-flex;
  align-items: center;
  padding: 6px;
  border-radius: 999px;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg);
  background: var(--bg);
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.28);
  position: relative;
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
/* Le pressé doit s'entendre tout de suite : le retour est sur l'appui, pas au
   relâchement. */
button:active:not(:disabled) { transform: scale(0.97) }
button { transition: transform 100ms cubic-bezier(0.23, 1, 0.32, 1) }
/*
 * Icône en masque plutôt qu'en emoji : ⚙️ est rendu en couleur et à une chasse
 * différente sur chaque OS. Le masque suit currentColor, donc l'état désactivé
 * et le focus restent cohérents avec les autres boutons, et rien n'entre dans le
 * DOM — pas de SVG à injecter sur une page en Trusted Types.
 */
button[data-icon]::before {
  content: "";
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}
button[data-icon="sliders"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 7h5M15 7h5M4 12h9M19 12h1M4 17h3M13 17h7'/%3E%3Ccircle cx='12' cy='7' r='2.5'/%3E%3Ccircle cx='16' cy='12' r='2.5'/%3E%3Ccircle cx='10' cy='17' r='2.5'/%3E%3C/svg%3E");
}
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
.settings-popover {
  position: absolute;
  bottom: 100%;
  right: 0;
  /* Même fond que la pastille : le popover en est le prolongement, pas une
     surface étrangère posée dessus. Le liseré clair fait l'arête. */
  background: var(--bg);
  border-radius: 10px;
  border: 1px solid var(--line);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.45);
  padding: 12px;
  min-width: 210px;
  color: var(--fg);
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.95) translateY(4px);
  /* Un popover s'ouvre depuis ce qui l'a ouvert : sans ça il grandit depuis son
     centre et le lien avec le bouton se perd. */
  transform-origin: bottom right;
  transition:
    opacity 150ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
  z-index: 10000;
  margin-bottom: 8px;
}
@media (prefers-reduced-motion: reduce) {
  .settings-popover { transform: none; transition: opacity 120ms ease-out }
  .settings-popover[data-open] { transform: none }
  button:active:not(:disabled) { transform: none }
}
.settings-popover[data-open] {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1) translateY(0);
}
.settings-row { display: flex; flex-direction: column; gap: 6px }
.settings-row + .settings-row { margin-top: 12px }
.settings-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  font-weight: 600;
  cursor: pointer;
}
/* La valeur vit dans l'intitulé, à droite : elle appartient au réglage, pas à
   une ligne de plus. Chasse fixe pour que 1,0× et 1,2× ne la fassent pas
   sauter d'un pixel à chaque cran. */
.settings-value {
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.settings-control {
  width: 100%;
  font: inherit;
  font-size: 12px;
  color: var(--fg);
  cursor: pointer;
}
select.settings-control {
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgb(255 255 255 / 0.06);
  /* Un select natif tronque tout seul ; sans ça un nom de voix à rallonge
     élargit le popover jusqu'à le sortir de l'écran. */
  max-width: 100%;
}
select.settings-control:hover { background: rgb(255 255 255 / 0.12) }
input.settings-control { margin: 2px 0 }
.settings-control:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
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
function createPill(
  onPrimary: () => void,
  onSecondary: () => void,
  initialPrefs: ReaderPreferences
) {
  const host = document.createElement("orateur-reader-pill")
  host.style.cssText = HOST_STYLE

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = PILL_CSS
  root.append(style)

  const row = document.createElement("div")
  row.className = "pill-row"
  const primary = button(onPrimary)
  const label = document.createElement("span")
  const secondary = button(onSecondary)
  const settings = button(() => togglePopover())
  // Posé une fois : l'icône et son intitulé ne dépendent pas de l'état de
  // lecture, contrairement à ceux de ▶ et ⏹.
  settings.dataset.icon = "sliders"
  settings.setAttribute("aria-label", "Réglages de lecture")
  settings.setAttribute("aria-expanded", "false")
  // Replié : ▶ ⚙ ✕. Le titre s'ouvre entre ▶ et ⚙ pendant la lecture, donc les
  // deux boutons de bord ne bougent pas quand la pastille se déplie.
  row.append(primary, label, settings, secondary)
  root.append(row)

  // Construit une fois, jamais réécrit : `innerHTML` est refusé par les pages
  // en `require-trusted-types-for 'script'` (Google, GitHub…), et un re-rendu
  // à chaque clic ferait perdre le focus clavier.
  const popover = document.createElement("div")
  popover.className = "settings-popover"
  popover.setAttribute("role", "group")
  popover.setAttribute("aria-label", "Réglages de lecture")
  row.append(popover)

  let currentPrefs = initialPrefs
  let isPopoverOpen = false

  const engine = document.createElement("select")
  settingsRow("Moteur", engine)
  for (const [value, text, unavailable] of ENGINES) {
    const choice = document.createElement("option")
    choice.value = value
    choice.textContent = text
    // Proposé mais non sélectionnable : le choix reste visible comme cap, sans
    // permettre de le prendre et de se retrouver avec une lecture muette.
    choice.disabled = unavailable
    engine.append(choice)
  }
  engine.addEventListener("change", () =>
    savePrefs({ engine: engine.value as ReaderEngine })
  )

  const speed = document.createElement("input")
  const speedValue = settingsRow("Vitesse", speed)
  speed.type = "range"
  speed.min = String(SPEED.min)
  speed.max = String(SPEED.max)
  speed.step = String(SPEED.step)
  // `input` pour le retour, `change` pour l'écriture : le chiffre suit le
  // pouce tout au long du geste, mais on n'écrit dans le storage qu'au
  // relâchement — sinon c'est une écriture par pixel parcouru.
  speed.addEventListener("input", () => {
    speedValue.textContent = formatSpeed(speed.valueAsNumber)
  })
  speed.addEventListener("change", () => savePrefs({ speed: speed.valueAsNumber }))

  const voice = document.createElement("select")
  settingsRow("Voix", voice)
  // La valeur vide porte « laisser le navigateur choisir » : un select n'a pas
  // de null, et c'est aussi ce sur quoi il retombe si la voix enregistrée a
  // disparu de la machine.
  voice.addEventListener("change", () => savePrefs({ voiceURI: voice.value || null }))
  renderVoices()
  // Chrome charge ses voix après coup : sans cet événement la liste reste
  // réduite à « Par défaut » pendant les premières secondes de la page.
  speechSynthesis.addEventListener("voiceschanged", renderVoices)

  // Le shadow root ne voit pas les clics du reste de la page — l'écouteur doit
  // être sur le document. En capture, pour survivre à un `stopPropagation`.
  const onDocumentClick = (event: Event) => {
    if (isPopoverOpen && !event.composedPath().includes(row)) closePopover()
  }
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !isPopoverOpen) return
    closePopover()
    settings.focus()
  }
  document.addEventListener("click", onDocumentClick, true)
  document.addEventListener("keydown", onDocumentKeydown, true)

  /**
   * Pose un réglage dans le popover : intitulé à gauche, valeur lue à droite,
   * contrôle dessous. Le `<label>` rend l'intitulé cliquable, donc la cible de
   * pointage du réglage fait toute la largeur.
   */
  function settingsRow(title: string, control: HTMLElement) {
    const id = `orateur-${title.toLowerCase()}`
    control.id = id
    control.className = "settings-control"

    const container = document.createElement("div")
    container.className = "settings-row"
    const heading = document.createElement("label")
    heading.className = "settings-label"
    heading.htmlFor = id
    const name = document.createElement("span")
    name.textContent = title
    const value = document.createElement("span")
    value.className = "settings-value"
    heading.append(name, value)
    container.append(heading, control)
    popover.append(container)
    return value
  }

  /** Reflète les préférences en cours sur les contrôles déjà en place. */
  function syncControls() {
    engine.value = currentPrefs.engine
    speed.value = String(currentPrefs.speed)
    speedValue.textContent = formatSpeed(currentPrefs.speed)
    // Une voix absente de la liste — désinstallée, ou enregistrée sur une autre
    // machine — laisse le select retomber sur l'option vide, qui est justement
    // le défaut. Rien à rattraper.
    voice.value = currentPrefs.voiceURI ?? ""
  }

  function renderVoices() {
    const choices = [voiceChoice("", "Par défaut")]
    // Aucun tri ni filtre par langue : deviner la bonne, c'est risquer de
    // masquer celle que l'utilisateur veut. Le select natif défile seul.
    for (const available of speechSynthesis.getVoices()) {
      choices.push(voiceChoice(available.voiceURI, `${available.name} (${available.lang})`))
    }
    voice.replaceChildren(...choices)
    syncControls()
  }

  function closePopover() {
    isPopoverOpen = false
    popover.removeAttribute("data-open")
    settings.setAttribute("aria-expanded", "false")
  }

  function togglePopover() {
    isPopoverOpen = !isPopoverOpen
    popover.toggleAttribute("data-open", isPopoverOpen)
    settings.setAttribute("aria-expanded", String(isPopoverOpen))
    if (isPopoverOpen) syncControls()
  }

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

  return {
    attach,
    setState,
    remove: () => {
      document.removeEventListener("click", onDocumentClick, true)
      document.removeEventListener("keydown", onDocumentKeydown, true)
      speechSynthesis.removeEventListener("voiceschanged", renderVoices)
      host.remove()
    },
    updatePrefs: (prefs: ReaderPreferences) => {
      currentPrefs = prefs
      syncControls()
    },
  }
}

/** Moteurs proposés, et ceux qui ne sont pas encore là. */
const ENGINES: Array<[ReaderEngine, string, boolean]> = [
  ["system", "Voix système", false],
  ["supertonic", "Supertonic — bientôt", true],
]

function voiceChoice(value: string, text: string) {
  const choice = document.createElement("option")
  choice.value = value
  choice.textContent = text
  return choice
}

/** « 1,2× » — virgule décimale, et toujours une décimale pour ne pas sauter. */
function formatSpeed(speed: number) {
  return `${speed.toFixed(1).replace(".", ",")}×`
}

function button(onClick: () => void) {
  const element = document.createElement("button")
  element.type = "button"
  // Le mousedown par défaut déplace le caret et efface une sélection en cours.
  element.addEventListener("mousedown", (event) => event.preventDefault())
  element.addEventListener("click", onClick)
  return element
}
