import { savePrefs, SPEED, type ReaderEngine, type ReaderPreferences, type PillPosition } from "../../lib/reader-prefs"
import type { ReaderViewState } from "../../lib/reading-session.ts"
import { MODEL_CACHE_QUERY, type ModelCacheQueryMessage, type TtsLoadingReason } from "../../lib/tts-messages"
import { ENGINE_CAPABILITIES } from "../../lib/engine-capabilities.ts"
import { isPocketVoice, toPocketLanguage } from "../../lib/pocket/catalog.ts"
import type { SupertonicVoice } from "../../lib/supertonic/types.ts"
import { voiceOptions } from "../../lib/voice-options.ts"
import { track } from "../../lib/telemetry.ts"
import { applyTheme } from "../../lib/theme.ts"
import type { ColorTheme } from "../../lib/ui-prefs.ts"
import { PILL_CSS } from "./styles.ts"

type PillState = ReaderViewState

/**
 * `*-center` ajoute `left:50%` + une translation plutôt qu'un `right`/`left`
 * fixe : seul moyen de rester centré quel que soit la largeur de la pastille,
 * qui varie repliée/dépliée.
 */
const POSITION_RULES: Record<PillPosition, string> = {
  "top-left": "top:16px!important;left:16px!important",
  "top-center": "top:16px!important;left:50%!important;transform:translateX(-50%)!important",
  "top-right": "top:16px!important;right:16px!important",
  "bottom-left": "bottom:16px!important;left:16px!important",
  "bottom-center": "bottom:16px!important;left:50%!important;transform:translateX(-50%)!important",
  "bottom-right": "bottom:16px!important;right:16px!important",
}

/**
 * Pose la position sur le host : le style inline *et* l'attribut dont dépendent
 * les variantes CSS du toast et du popover. Les deux ensemble dans une seule
 * fonction pour qu'ils ne puissent pas diverger — même forme que `applyTheme`.
 *
 * Le storage n'est pas une source sûre : une valeur inconnue doit retomber sur
 * le défaut des deux côtés, sinon la pastille se pose en bas-à-droite pendant
 * qu'aucun sélecteur de variante ne matche.
 */
function applyPosition(position: PillPosition, host: HTMLElement) {
  const safe = position in POSITION_RULES ? position : "bottom-right"
  host.style.cssText =
    `all:initial!important;position:fixed!important;${POSITION_RULES[safe]};z-index:2147483647!important`
  host.dataset.orateurPosition = safe
}

/** How long the hide toast offers to undo, not counting hover, focus or a hidden tab. */
const HIDE_TOAST_DELAY = 5000

/** Pointer clicks on Undo sooner than this after the toast shows are ignored (OS double-click window). */
const UNDO_GUARD = 500

/** Libellé et intitulé accessible de chaque bouton, état par état. */
const LABELS: Record<PillState, { primary: string; secondary: string }> = {
  idle: { primary: "play", secondary: "x" },
  loading: { primary: "loader-circle", secondary: "x" },
  playing: { primary: "pause", secondary: "square" },
  paused: { primary: "play", secondary: "square" },
  error: { primary: "play", secondary: "x" },
}

/**
 * Pastille flottante, dans un shadow root fermé — même isolation que la bulle
 * de sélection, pour les mêmes raisons.
 */
export function createPill(
  onPrimary: () => void,
  onSecondary: () => void,
  onPrevious: () => void,
  onNext: () => void,
  initialPrefs: ReaderPreferences,
  attached: boolean,
  initialTheme: ColorTheme
) {
  // Une extension rechargée ne peut plus exécuter le nettoyage de son ancien
  // content script. Retirer sa pastille orpheline avant de monter la nouvelle.
  document.querySelectorAll("orateur-reader-pill").forEach((element) => element.remove())

  // Résolu ici, pas en haut du module : WXT importe ce fichier sous un faux
  // `browser` (sans `i18n`) pour en lire la config au build, et createPill ne
  // tourne qu'au vrai runtime du content script, appelé depuis main().
  const ARIA: Record<PillState, { primary: string; secondary: string }> = {
    idle: { primary: browser.i18n.getMessage("ariaReadPage"), secondary: browser.i18n.getMessage("ariaHidePill") },
    loading: { primary: browser.i18n.getMessage("ariaExtracting"), secondary: browser.i18n.getMessage("ariaHidePill") },
    playing: { primary: browser.i18n.getMessage("ariaPause"), secondary: browser.i18n.getMessage("ariaStopReading") },
    paused: { primary: browser.i18n.getMessage("ariaResume"), secondary: browser.i18n.getMessage("ariaStopReading") },
    error: { primary: browser.i18n.getMessage("ariaRetryReading"), secondary: browser.i18n.getMessage("ariaHidePill") },
  }
  const ENGINES: Array<[ReaderEngine, string]> = [
    ["pocket", browser.i18n.getMessage("enginePocket")],
    ["system", browser.i18n.getMessage("engineSystem")],
    ["supertonic", browser.i18n.getMessage("engineNaturalAI")],
  ]

  const host = document.createElement("orateur-reader-pill")
  host.lang = browser.i18n.getUILanguage()
  host.translate = false
  applyPosition(initialPrefs.position, host)
  applyTheme(initialTheme, host)

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = PILL_CSS
  root.append(style)

  const row = document.createElement("div")
  row.className = "pill-row"
  const surfaces = ["compact", "card"].map((shape) => {
    const surface = document.createElement("div")
    surface.className = `pill-surface pill-surface-${shape}`
    surface.setAttribute("aria-hidden", "true")
    surface.inert = true
    row.append(surface)
    return surface
  })
  const content = document.createElement("div")
  content.className = "pill-content"
  const label = document.createElement("span")
  label.className = "pill-title"
  label.dir = "auto"
  const statusRow = document.createElement("div")
  statusRow.className = "pill-status-row"
  const status = document.createElement("span")
  status.className = "pill-status"
  status.setAttribute("role", "status")
  const percent = document.createElement("span")
  percent.className = "pill-percent"
  percent.setAttribute("aria-hidden", "true")
  statusRow.append(status)
  const progress = document.createElement("div")
  progress.className = "pill-progress"
  progress.setAttribute("role", "progressbar")
  progress.setAttribute("aria-valuemin", "0")
  progress.setAttribute("aria-valuemax", "100")
  progress.setAttribute("aria-label", browser.i18n.getMessage("ttsDownloadingModel"))
  const progressFill = document.createElement("div")
  progressFill.className = "pill-progress-fill"
  progress.append(progressFill)
  content.append(label, statusRow, progress, percent)

  const controls = document.createElement("div")
  controls.className = "pill-controls"
  const transport = document.createElement("div")
  transport.className = "pill-transport"
  const previous = button(onPrevious)
  previous.dataset.icon = "previous"
  previous.setAttribute("aria-label", browser.i18n.getMessage("ariaPreviousParagraph"))
  previous.title = previous.getAttribute("aria-label")!
  const primary = button(onPrimary)
  primary.className = "pill-primary"
  const next = button(onNext)
  next.dataset.icon = "next"
  next.setAttribute("aria-label", browser.i18n.getMessage("ariaNextParagraph"))
  next.title = next.getAttribute("aria-label")!
  const meta = document.createElement("span")
  meta.className = "pill-meta"
  const spacer = document.createElement("span")
  spacer.className = "pill-spacer"
  // `detail === 0` marks a keyboard activation: only then does the hide toast
  // take the focus, so a mouse user's toast is never held open by focus.
  let secondaryByKeyboard = false
  const secondary = button((event) => {
    secondaryByKeyboard = event.detail === 0
    onSecondary()
  })
  secondary.className = "pill-secondary"
  const settings = button((event) => togglePopover(event.detail === 0))
  settings.className = "pill-settings"
  // Posé une fois : l'icône et son intitulé ne dépendent pas de l'état de
  // lecture, contrairement à ceux de ▶ et ⏹.
  settings.dataset.icon = "settings"
  settings.setAttribute("aria-label", browser.i18n.getMessage("ariaReadingSettings"))
  settings.title = settings.getAttribute("aria-label")!
  settings.setAttribute("aria-expanded", "false")
  settings.setAttribute("aria-controls", "orateur-reading-settings")
  transport.append(previous, primary, next)
  controls.append(transport, meta, spacer, settings, secondary)
  row.append(content, controls)
  root.append(row)

  // Construit une fois, jamais réécrit : `innerHTML` est refusé par les pages
  // en `require-trusted-types-for 'script'` (Google, GitHub…), et un re-rendu
  // à chaque clic ferait perdre le focus clavier.
  const popover = document.createElement("div")
  popover.className = "settings-popover"
  popover.id = "orateur-reading-settings"
  popover.inert = true
  popover.setAttribute("role", "group")
  popover.setAttribute("aria-label", browser.i18n.getMessage("ariaReadingSettings"))
  row.append(popover)

  /**
   * Replaces the controls once the close button hid Orateur on the site
   * (`confirmHidden`): it says so and offers to undo for `HIDE_TOAST_DELAY`.
   */
  const toast = document.createElement("div")
  toast.className = "pill-toast"
  toast.setAttribute("role", "status")
  toast.hidden = true
  const toastText = document.createElement("span")
  toastText.className = "pill-toast-text"
  toastText.id = "orateur-hidden-toast"
  // Undo appears where ✕ was: a pointer click this soon is the second half of
  // a double-click on ✕, not a decision. The keyboard (`detail === 0`) is exempt.
  const undo = button((event) => {
    if (event.detail > 0 && performance.now() - hideShownAt < UNDO_GUARD) return
    undoHide?.()
  })
  undo.className = "pill-toast-undo"
  undo.textContent = browser.i18n.getMessage("readerHiddenUndo")
  undo.setAttribute("aria-label", undo.textContent)
  undo.setAttribute("aria-describedby", toastText.id)
  toast.append(toastText, undo)
  row.append(toast)
  /** Set while the toast shows; each ends it, with or without detaching the pill. */
  let undoHide: (() => void) | null = null
  let endHide: ((detach: boolean) => void) | null = null
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let hideRemaining = 0
  let hideStarted = 0
  let hideShownAt = 0
  /** Hover, focus and a hidden tab each hold the countdown until they all end. */
  const hidePauses = new Set<"hover" | "focus" | "tab">()
  const onHideVisibility = () => document.hidden ? pauseHide("tab") : resumeHide("tab")
  // A move, not `pointerenter`: the toast appears under the cursor that just
  // clicked ✕, and a still cursor must not hold it open.
  toast.addEventListener("pointermove", () => pauseHide("hover"))
  toast.addEventListener("pointerleave", () => resumeHide("hover"))
  toast.addEventListener("focusin", () => pauseHide("focus"))
  toast.addEventListener("focusout", (event) => {
    if (!toast.contains(event.relatedTarget as Node | null)) resumeHide("focus")
  })
  toast.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !endHide) return
    event.preventDefault()
    event.stopPropagation()
    endHide(true)
  })

  let currentPrefs = initialPrefs
  let isPopoverOpen = false
  let currentState: PillState = "idle"
  let currentBlock = 0
  let totalBlocks = 0
  let navigationActive = false
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
  let animations: Animation[] = []
  let contentCopy: HTMLElement | undefined
  let motionRevision = 0

  const engine = document.createElement("select")
  settingsRow(browser.i18n.getMessage("settingsEngineLabel"), engine)
  for (const [value, text] of ENGINES) {
    const choice = document.createElement("option")
    choice.value = value
    choice.textContent = text
    engine.append(choice)
  }
  engine.addEventListener("change", () => {
    savePrefs({ engine: engine.value as ReaderEngine })
    // currentPrefs n'a pas encore le nouveau moteur — l'écriture passe par un
    // aller-retour storage — mais le select Voix doit changer de liste tout
    // de suite, pas attendre onPrefsChanged.
    currentPrefs = { ...currentPrefs, engine: engine.value as ReaderEngine }
    renderVoices()
    // Télémétrie (jalon 1c) : moment où l'intérêt pour Supertonic se marque,
    // avant tout téléchargement — sert de tête d'entonnoir jusqu'à
    // supertonic_download_completed/_failed.
    if (engine.value === "supertonic") track({ name: "supertonic_offered" })
  })

  // Only a confirmed missing extension cache needs the first-download note.
  let modelCached: Partial<Record<"supertonic" | "pocket", boolean>> = {}
  let modelCacheRequest = 0
  const modelNote = document.createElement("div")
  modelNote.className = "settings-note"
  const noteLead = document.createElement("strong")
  const noteRest = document.createElement("div")
  // The download happens on the first local-model reading, so the button just
  // starts one: progress then shows in the pill, where the eye already is.
  const noteDownload = document.createElement("button")
  noteDownload.type = "button"
  noteDownload.className = "settings-download"
  noteDownload.addEventListener("click", () => {
    closePopover()
    // Already loading or reading: onPrimary would pause, not download.
    if (currentState === "idle" || currentState === "error") onPrimary()
  })
  modelNote.append(noteLead, noteRest, noteDownload)
  popover.append(modelNote)

  const speed = document.createElement("input")
  const speedValue = settingsRow(browser.i18n.getMessage("settingsSpeedLabel"), speed)
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
  settingsRow(browser.i18n.getMessage("settingsVoiceLabel"), voice)
  voice.addEventListener("change", () => {
    if (currentPrefs.engine === "pocket") {
      if (isPocketVoice(voice.value)) void savePrefs({ pocketVoice: voice.value })
    } else if (currentPrefs.engine === "supertonic") {
      savePrefs({ supertonicVoice: voice.value as SupertonicVoice })
    } else {
      // La valeur vide porte « laisser le navigateur choisir » : un select
      // n'a pas de null, et c'est aussi ce sur quoi il retombe si la voix
      // enregistrée a disparu de la machine.
      savePrefs({ voiceURI: voice.value || null })
    }
  })
  /**
   * Suivi de la lecture sur la page. En pied de popover : c'est le seul
   * réglage qui ne parle pas de la voix.
   */
  const follow = document.createElement("input")
  follow.type = "checkbox"
  follow.id = "orateur-follow"
  const followRow = document.createElement("label")
  followRow.className = "settings-toggle"
  followRow.htmlFor = follow.id
  const followText = document.createElement("span")
  followText.textContent = browser.i18n.getMessage("settingsFollowLabel")
  followRow.append(follow, followText)
  popover.append(followRow)
  follow.addEventListener("change", () => savePrefs({ follow: follow.checked }))
  // The voice list is built on first popover open (see setPopover): calling
  // getVoices() makes Chrome enumerate voices, too costly for every page load.
  let voicesWatched = false

  // Le shadow root ne voit pas les clics du reste de la page — l'écouteur doit
  // être sur le document. En capture, pour survivre à un `stopPropagation`.
  const onDocumentClick = (event: Event) => {
    if (isPopoverOpen && !event.composedPath().includes(host)) closePopover()
  }
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !isPopoverOpen) return
    event.preventDefault()
    event.stopPropagation()
    closePopover(true)
    settings.focus()
  }
  document.addEventListener("click", onDocumentClick, true)
  document.addEventListener("keydown", onDocumentKeydown, true)
  const onWindowResize = () => {
    settleMotion()
    if (isPopoverOpen) fitPopover()
  }
  window.addEventListener("resize", onWindowResize)
  reducedMotion.addEventListener("change", settleMotion)
  row.addEventListener("focusout", (event) => {
    if (isPopoverOpen && !row.contains(event.relatedTarget as Node | null)) closePopover(true)
  })

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
    if (currentPrefs.engine === "pocket") {
      voice.value = currentPrefs.pocketVoice
    } else if (currentPrefs.engine === "supertonic") {
      voice.value = currentPrefs.supertonicVoice
    } else {
      // Une voix absente de la liste — désinstallée, ou enregistrée sur une
      // autre machine — laisse le select retomber sur l'option vide, qui est
      // justement le défaut. Rien à rattraper.
      voice.value = currentPrefs.voiceURI ?? ""
    }
    follow.checked = currentPrefs.follow
    updateMeta()
    updateModelNote()
    if (isPopoverOpen && ENGINE_CAPABILITIES[currentPrefs.engine].requiresModel) void refreshModelCached()
  }

  /** Reflète `modelCached` sur le texte et la visibilité de la note. */
  function updateModelNote() {
    const engine = currentPrefs.engine
    const hidden = engine === "system" || modelCached[engine] !== false
    if (modelNote.hidden !== hidden && animations.length) settleMotion()
    modelNote.hidden = hidden
    if (modelNote.hidden) return
    const pocket = engine === "pocket"
    noteLead.textContent = pocket ? "" : browser.i18n.getMessage("optionsModelAlertPendingLead")
    noteRest.textContent = browser.i18n.getMessage(pocket ? "optionsPocketModelNote" : "optionsModelAlertPending")
    noteDownload.textContent = browser.i18n.getMessage(pocket ? "optionsPocketReadCta" : "optionsModelDownloadCta")
  }

  async function refreshModelCached() {
    const engine = currentPrefs.engine
    if (engine === "system") return
    const request = ++modelCacheRequest
    let cached: unknown
    try {
      const lang = engine === "pocket" ? toPocketLanguage(document.documentElement.lang) ?? undefined : undefined
      const voice = engine === "pocket" ? currentPrefs.pocketVoice : undefined
      cached = await browser.runtime.sendMessage({ type: MODEL_CACHE_QUERY, engine, lang, voice } satisfies ModelCacheQueryMessage)
    } catch {
      cached = undefined
    }
    if (request !== modelCacheRequest) return
    modelCached[engine] = typeof cached === "boolean" ? cached : undefined
    updateModelNote()
    if (isPopoverOpen) fitPopover()
  }

  function renderVoices() {
    if (currentPrefs.engine !== "system") {
      voice.replaceChildren(...voiceOptions(currentPrefs.engine).map((option) =>
        voiceChoice(option.id, "key" in option ? browser.i18n.getMessage(option.key) : option.text)))
      syncControls()
      return
    }
    const choices = [voiceChoice("", browser.i18n.getMessage("voiceDefault"))]
    // Aucun tri ni filtre par langue : deviner la bonne, c'est risquer de
    // masquer celle que l'utilisateur veut. Le select natif défile seul.
    for (const available of speechSynthesis.getVoices()) {
      choices.push(voiceChoice(available.voiceURI, `${available.name} (${available.lang})`))
    }
    voice.replaceChildren(...choices)
    syncControls()
  }

  function settleMotion() {
    motionRevision++
    for (const animation of animations) animation.cancel()
    animations = []
    contentCopy?.remove()
    contentCopy = undefined
    content.style.opacity = ""
    popover.style.transform = ""
    for (const surface of surfaces) surface.removeAttribute("style")
  }

  function animateLayout(update: () => void, instant = false) {
    // Sample displayed values before cancellation, including interrupted exits.
    const moving = [previous, primary, next, meta, settings, secondary]
    const beforeControls = moving.map((element) => ({
      rect: element.getBoundingClientRect(),
      opacity: Number(getComputedStyle(element).opacity),
    }))
    const beforePanel = popover.getBoundingClientRect()
    const panelOpacity = Number(getComputedStyle(popover).opacity)
    const beforeSurfaces = surfaces.map((surface) => ({
      rect: surface.getBoundingClientRect(),
      opacity: Number(getComputedStyle(surface).opacity),
    }))
    const visibleContent = contentCopy ?? (host.hasAttribute("data-expanded") ? content : undefined)
    const beforeContent = visibleContent?.getBoundingClientRect()
    const contentOpacity = visibleContent ? Number(getComputedStyle(visibleContent).opacity) : 0
    const outgoingContent = visibleContent?.cloneNode(true) as HTMLElement | undefined

    // Keep native surface dimensions on reversals; only hidden layers may resize.
    motionRevision++
    for (const animation of animations) animation.cancel()
    animations = []
    contentCopy?.remove()
    contentCopy = undefined
    content.style.opacity = ""
    popover.style.transform = ""
    update()
    fitPopover()
    if (instant || !host.isConnected || typeof popover.animate !== "function") {
      settleMotion()
      return
    }

    const reduced = reducedMotion.matches
    const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)"
    const shapeEase = "cubic-bezier(0.77, 0, 0.175, 1)"
    const translate = (x: number, y: number) => `translate(${x}px, ${y}px)`
    const animate = (element: HTMLElement, frames: Keyframe[], duration: number, easing = easeOut, delay = 0) => {
      animations.push(element.animate(frames, { duration, easing, delay, fill: "both" }))
    }
    const bounds = row.getBoundingClientRect()
    if (!reduced && bounds.width > 0 && bounds.height > 0) {
      // Real width/height, not a FLIP scale: a non-uniform scale stretches the
      // radius, border and shadow, and its last frame stays stretched while a
      // blocking dialog (resume `confirm`) delays `settleMotion`.
      // ponytail: layout-animating two absolutely positioned layers is cheap;
      // revisit only if the pill ever animates many of them.
      const expanded = host.hasAttribute("data-expanded")
      surfaces.forEach((surface, index) => {
        const before = beforeSurfaces[index]!
        const from = before.opacity > 0 && before.rect.width > 0 ? before.rect : bounds
        animate(surface, [
          {
            transform: translate(from.left - bounds.left, from.top - bounds.top),
            width: `${from.width}px`,
            height: `${from.height}px`,
            opacity: before.opacity,
          },
          {
            transform: "translate(0px, 0px)",
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            opacity: Number(index === (expanded ? 1 : 0)),
          },
        ], 220, shapeEase)
      })
      moving.forEach((element, index) => {
        if (element.hidden) return
        const after = element.getBoundingClientRect()
        const opacity = Number(getComputedStyle(element).opacity)
        const before = beforeControls[index]!
        animate(element, [
          {
            transform: before.rect.width > 0 ? translate(before.rect.left - after.left, before.rect.top - after.top) : "translate(0px, 0px)",
            opacity: before.rect.width > 0 ? before.opacity : 0,
          },
          { transform: "translate(0px, 0px)", opacity },
        ], 220, shapeEase)
      })
    } else {
      for (const surface of surfaces) surface.removeAttribute("style")
    }

    const afterPanel = popover.getBoundingClientRect()
    const slide = currentPrefs.position.startsWith("top") ? -4 : 4
    const x = panelOpacity > 0 ? beforePanel.left - afterPanel.left : 0
    const y = panelOpacity > 0 ? beforePanel.top - afterPanel.top : slide
    // Reduced motion keeps the exit anchored without animating its position.
    if (reduced && panelOpacity > 0) popover.style.transform = translate(x, y)
    if (panelOpacity > 0 || isPopoverOpen) animate(popover, [
      { opacity: panelOpacity, ...(!reduced && { transform: translate(x, y) }) },
      { opacity: Number(isPopoverOpen), ...(!reduced && { transform: isPopoverOpen ? "translate(0px, 0px)" : translate(x, y + slide) }) },
    ], reduced ? 120 : isPopoverOpen ? 180 : 150)

    const hasCardContent = host.hasAttribute("data-expanded")
    if (beforeContent || hasCardContent) {
      const target = hasCardContent ? content.getBoundingClientRect() : beforeContent!
      contentCopy = hasCardContent ? content.cloneNode(true) as HTMLElement : outgoingContent!
      contentCopy.className = "pill-content-copy"
      contentCopy.setAttribute("aria-hidden", "true")
      contentCopy.inert = true
      contentCopy.style.left = `${target.left - bounds.left - 1}px`
      contentCopy.style.top = `${target.top - bounds.top - 1}px`
      contentCopy.style.width = `${target.width}px`
      contentCopy.style.opacity = ""
      row.append(contentCopy)
      content.style.opacity = "0"
      animate(contentCopy, [
        { opacity: contentOpacity, ...(!reduced && { transform: beforeContent ? translate(beforeContent.left - target.left, beforeContent.top - target.top) : "translate(0px, 4px)" }) },
        { opacity: Number(hasCardContent), ...(!reduced && { transform: "translate(0px, 0px)" }) },
      ], 120, easeOut, hasCardContent && contentOpacity < 0.01 && !reduced ? 150 : 0)
    }
    const revision = motionRevision
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (revision === motionRevision) settleMotion()
    }).catch(() => { /* Cancellation belongs to the next interaction. */ })
  }

  function setPopover(open: boolean, instant: boolean) {
    animateLayout(() => {
      isPopoverOpen = open
      popover.inert = !open
      popover.toggleAttribute("data-open", open)
      settings.setAttribute("aria-expanded", String(open))
      updateLayout()
      if (open) {
        modelCached = {}
        if (!voicesWatched) {
          voicesWatched = true
          // Chrome charge ses voix après coup : sans cet événement la liste reste
          // réduite à « Par défaut » pendant les premières secondes de la page.
          speechSynthesis.addEventListener("voiceschanged", renderVoices)
        }
        // Also syncs the controls.
        renderVoices()
      }
    }, instant)
  }

  function closePopover(instant = false) {
    setPopover(false, instant)
  }

  function togglePopover(keyboard = false) {
    if (isPopoverOpen) return closePopover(keyboard)
    setPopover(true, keyboard)
    if (keyboard) engine.focus()
  }

  function updateLayout() {
    const expanded = currentState !== "idle" && currentState !== "loading" && !isPopoverOpen
    host.toggleAttribute("data-expanded", expanded)
    row.toggleAttribute("data-settings-open", isPopoverOpen)
    // Clip the card visually, retaining live announcements and inline loading feedback.
    content.hidden = currentState === "idle"
  }

  function fitPopover() {
    // Account for wrapped titles, both dock margins and the gap to the reader.
    popover.style.maxHeight = `${Math.max(0, window.innerHeight - row.offsetHeight - 40)}px`
  }

  function attach() {
    // `body` est absent d'un document XML ou SVG.
    if (!host.isConnected) (document.body ?? document.documentElement).append(host)
  }

  // Site exclu (réglages → Sites) : la pastille reste montée en mémoire,
  // prête pour `pill.attach()`, mais hors du DOM tant que rien ne la demande.
  if (attached) attach()
  setState("idle")

  /**
   * Shows the hide toast in place of the controls. The site is already hidden
   * (optimistic): `onUndo` reverts that, the toast only reports it. Without an
   * action the toast leaves after `HIDE_TOAST_DELAY` and the pill is detached.
   */
  function confirmHidden(onUndo: () => void) {
    if (endHide) return
    const keyboard = secondaryByKeyboard
    if (isPopoverOpen) closePopover(true)
    // The error card folds too: the toast replaces the whole pill.
    animateLayout(() => {
      row.toggleAttribute("data-toast", true)
      host.removeAttribute("data-expanded")
      row.removeAttribute("data-active")
      content.hidden = true
      controls.hidden = true
      toast.hidden = false
      toastText.textContent = ""
    })
    hideShownAt = performance.now()
    // Filled after the region shows, so screen readers announce the change.
    requestAnimationFrame(() => {
      if (endHide) toastText.textContent = browser.i18n.getMessage("readerHiddenToast")
    })
    hideRemaining = HIDE_TOAST_DELAY
    hidePauses.clear()
    document.addEventListener("visibilitychange", onHideVisibility)
    endHide = (detach) => {
      clearTimeout(hideTimer)
      hidePauses.clear()
      document.removeEventListener("visibilitychange", onHideVisibility)
      undoHide = endHide = null
      const restore = () => {
        row.removeAttribute("data-toast")
        toast.hidden = true
        toastText.textContent = ""
        controls.hidden = false
        row.toggleAttribute("data-active", currentState !== "idle")
        updateLayout()
      }
      if (!detach) return animateLayout(restore)
      let exit: Animation | undefined
      const done = () => {
        settleMotion()
        host.remove()
        // `fill: forwards` held the faded frame until the removal; drop it so a
        // later `attach()` (site restored from Settings) shows the pill.
        exit?.cancel()
        restore()
      }
      if (!host.isConnected || typeof row.animate !== "function") return done()
      const frames = reducedMotion.matches
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.95)" }]
      exit = row.animate(frames, { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" })
      void exit.finished.then(done, done)
    }
    undoHide = () => {
      const hadFocus = toast.contains(root.activeElement)
      endHide?.(false)
      onUndo()
      if (hadFocus) secondary.focus()
    }
    // Start the countdown first: a pause measures the time already elapsed.
    scheduleHide()
    if (document.hidden) pauseHide("tab")
    if (keyboard) undo.focus()
  }

  function scheduleHide() {
    clearTimeout(hideTimer)
    if (!endHide || hidePauses.size) return
    hideStarted = Date.now()
    hideTimer = setTimeout(() => endHide?.(true), Math.max(0, hideRemaining))
  }

  function pauseHide(reason: "hover" | "focus" | "tab") {
    if (!endHide || hidePauses.has(reason)) return
    if (!hidePauses.size) {
      clearTimeout(hideTimer)
      hideRemaining -= Date.now() - hideStarted
    }
    hidePauses.add(reason)
  }

  function resumeHide(reason: "hover" | "focus" | "tab") {
    if (hidePauses.delete(reason)) scheduleHide()
  }

  function setState(
    state: PillState,
    title?: string,
    interruptible = false,
    loadingInfo?: { label: string; percent?: number; reason?: TtsLoadingReason }
  ) {
    // A reading started meanwhile (context menu) needs the controls back; the
    // site stays hidden, as when a reading starts on an excluded site.
    if (endHide && state !== "idle") endHide(false)
    const playbackStates = ["playing", "paused"]
    const layoutChanged = state !== currentState &&
      !(playbackStates.includes(state) && playbackStates.includes(currentState))
    const update = () => renderState(state, title, interruptible, loadingInfo)
    if (layoutChanged) animateLayout(update)
    else update()
  }

  function renderState(
    state: PillState,
    title?: string,
    interruptible = false,
    loadingInfo?: { label: string; percent?: number; reason?: TtsLoadingReason }
  ) {
    const wasLoading = currentState === "loading"
    currentState = state
    const activeLoading = state === "loading" && interruptible
    const downloading = state === "loading" && (
      loadingInfo?.reason === "downloading-model" || Number.isFinite(loadingInfo?.percent)
    )
    const statusText = state === "loading"
      ? loadingInfo?.label ?? browser.i18n.getMessage(activeLoading ? "ttsLoadingVoice" : "ariaExtracting")
      : state === "error" ? browser.i18n.getMessage("readerErrorRecovery")
      : state === "paused" ? browser.i18n.getMessage("readerPaused")
      : state === "playing" ? browser.i18n.getMessage("readerPlaying") : ""
    primary.dataset.icon = downloading ? "cloud-download" : LABELS[state].primary
    primary.setAttribute("aria-label", state === "loading" ? statusText : ARIA[state].primary)
    secondary.dataset.icon = activeLoading ? "square" : LABELS[state].secondary
    secondary.setAttribute("aria-label", activeLoading ? ARIA.playing.secondary : ARIA[state].secondary)
    primary.title = primary.getAttribute("aria-label")!
    secondary.title = secondary.getAttribute("aria-label")!
    // Preparation cannot pause or resume; long waits remain cancellable.
    primary.disabled = state === "loading"
    secondary.disabled = state === "loading" && !interruptible
    // Le titre n'est réécrit que quand on en fournit un : une pause ne doit
    // pas le perdre — donc pas replier la pastille — juste changer l'icône.
    if (title !== undefined) label.textContent = title || browser.i18n.getMessage("readerUntitled")
    updateLayout()
    row.toggleAttribute("data-active", state !== "idle")
    row.toggleAttribute("data-loading", state === "loading")
    row.toggleAttribute("data-downloading", downloading)
    previous.hidden = next.hidden = meta.hidden = state !== "playing" && state !== "paused"
    spacer.hidden = !meta.hidden || state === "loading"
    navigationActive = state === "playing" || state === "paused"
    updateNavigation()
    label.hidden = !label.textContent || state === "loading"
    status.setAttribute("role", state === "error" ? "alert" : "status")
    if (status.textContent !== statusText) status.textContent = statusText
    status.title = statusText
    const downloadPercent = state === "loading" && Number.isFinite(loadingInfo?.percent)
      ? Math.round(Math.min(100, Math.max(0, loadingInfo!.percent!))) : undefined
    progress.hidden = !downloading
    percent.hidden = downloadPercent === undefined
    if (downloadPercent !== undefined) {
      percent.textContent = `${downloadPercent}%`
      progress.setAttribute("aria-valuenow", String(downloadPercent))
      progressFill.style.transform = `scaleX(${downloadPercent / 100})`
    } else {
      percent.textContent = ""
      progress.removeAttribute("aria-valuenow")
      progressFill.style.transform = "scaleX(0)"
    }
    if (isPopoverOpen) {
      fitPopover()
      if (wasLoading && state === "playing" && ENGINE_CAPABILITIES[currentPrefs.engine].requiresModel) {
        void refreshModelCached()
      }
    }
  }

  function updateNavigation() {
    previous.disabled = !navigationActive || totalBlocks <= 0 || currentBlock <= 0
    next.disabled = !navigationActive || totalBlocks <= 0 || currentBlock >= totalBlocks - 1
  }

  function setPosition(block: number, total: number) {
    currentBlock = block
    totalBlocks = total
    updateNavigation()
    updateMeta()
  }

  function updateMeta() {
    meta.textContent = totalBlocks > 0
      ? browser.i18n.getMessage("readerProgress", [String(currentBlock + 1), String(totalBlocks), formatSpeed(currentPrefs.speed)])
      : formatSpeed(currentPrefs.speed)
  }

  return {
    attach,
    // Retire juste l'élément du DOM : contrairement à `remove`, les écouteurs
    // document restent en place. C'est ce qui permet à `attach()` de rendre
    // ensuite une pastille dont le popover se referme encore au clic
    // extérieur et à Échap — un site exclu peut alterner détaché/rattaché
    // toute la session, `remove` ne devant jouer qu'une fois, au déchargement.
    detach: () => {
      // The hide toast detaches the pill itself once it leaves; the hidden
      // site's storage change must not cut it short.
      // shortcut: a site restored from another tab during those 5 s is still
      // detached here until the page reloads; track the sites if that matters.
      if (endHide) return
      settleMotion()
      host.remove()
    },
    confirmHidden,
    setState,
    setPosition,
    /** Resolves once the running transition ends, or is cancelled by the next one. */
    settled: () => Promise.all(animations.map((animation) => animation.finished)).then(() => {}, () => {}),
    remove: () => {
      clearTimeout(hideTimer)
      document.removeEventListener("visibilitychange", onHideVisibility)
      undoHide = endHide = null
      settleMotion()
      document.removeEventListener("click", onDocumentClick, true)
      document.removeEventListener("keydown", onDocumentKeydown, true)
      window.removeEventListener("resize", onWindowResize)
      reducedMotion.removeEventListener("change", settleMotion)
      speechSynthesis.removeEventListener("voiceschanged", renderVoices)
      host.remove()
    },
    updatePrefs: (prefs: ReaderPreferences) => {
      if (prefs.position !== currentPrefs.position) {
        settleMotion()
        applyPosition(prefs.position, host)
      }
      const engineChanged = currentPrefs.engine !== prefs.engine
      currentPrefs = prefs
      if (engineChanged) renderVoices()
      else syncControls()
    },
    setTheme: (theme: ColorTheme) => applyTheme(theme, host),
  }
}

function voiceChoice(value: string, text: string) {
  const choice = document.createElement("option")
  choice.value = value
  choice.textContent = text
  return choice
}

/**
 * « 1,2× » en français, « 1.2× » en anglais — le séparateur suit la langue du
 * navigateur (`Intl`), pas une virgule française codée en dur. Toujours une
 * décimale pour ne pas sauter.
 */
function formatSpeed(speed: number) {
  const digit = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(speed)
  return `${digit}×`
}

function button(onClick: (event: MouseEvent) => void) {
  const element = document.createElement("button")
  element.type = "button"
  // Le mousedown par défaut déplace le caret et efface une sélection en cours.
  element.addEventListener("mousedown", (event) => event.preventDefault())
  element.addEventListener("click", onClick)
  return element
}
