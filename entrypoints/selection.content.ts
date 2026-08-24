import { placeBubble } from "../lib/bubble-position"
import { rangesToText, validateSelectionText } from "../lib/selection-text"
import { isHidden, loadHiddenSites } from "../lib/site-rules.ts"
import { charteTokens } from "../lib/charte.ts"
import { applyTheme } from "../lib/theme.ts"
import { loadUiPrefs, onUiPrefsChanged, type ColorTheme } from "../lib/ui-prefs.ts"

/**
 * Actions proposées sur une sélection.
 *
 * C'est le point d'extension de la feature : « Traduire », « Résumer » ou
 * « Sauvegarder » s'ajoutent ici et dans le `switch` du background. Ni la bulle
 * ni le menu contextuel ne portent de logique métier — ils transmettent un
 * identifiant et du texte.
 *
 * `labelKey`/`ariaLabelKey`, pas le texte résolu : WXT importe ce module sous
 * un faux `browser` (sans `i18n`) pour en lire la config au build, et une
 * phrase complète par clé — plutôt que concaténer un verbe et un suffixe fixe
 * — laisse chaque locale tourner la phrase comme elle veut.
 *
 * `icon` nomme une entrée `button[data-icon]` (masque CSS, voir BUBBLE_CSS) —
 * pas un emoji : rendu identique sur tous les OS, suit currentColor.
 */
const ACTIONS = [
  { id: "read", labelKey: "selectionRead", ariaLabelKey: "selectionReadAria", icon: "headphones" },
] as const

/**
 * `save` ne vit plus que dans le menu contextuel : la bulle est un raccourci de
 * lecture immédiate, pas un gestionnaire de file d'attente. Le type n'est donc
 * plus dérivé d'`ACTIONS`, qui ne décrit que les boutons de la bulle.
 */
export type SelectionAction = "read" | "save"

/** Ce que le background reçoit, quelle que soit la porte d'entrée. */
export interface SelectionPayload {
  text: string
  /** La sélection dépassait la limite : l'appelant doit le signaler. */
  truncated: boolean
  title?: string
  lang?: string
}

export interface SelectionActionMessage extends SelectionPayload {
  type: typeof SELECTION_ACTION
  action: SelectionAction
}

export const SELECTION_ACTION = "orateur:selection-action"
export const GET_SELECTION = "orateur:get-selection"

/** Touches qui étendent une sélection existante, avec le modificateur adéquat. */
const CARET_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

export default defineContentScript({
  // Contrairement à l'extracteur d'article, la bulle ne peut pas être injectée à
  // la demande : elle doit déjà être là au moment où l'utilisateur relâche la
  // souris. C'est ce qui coûte l'accès à toutes les pages dans le manifest.
  matches: ["<all_urls>"],
  // Chaque iframe reçoit sa propre instance et lit sa propre sélection : le
  // cas same-origin fonctionne sans traverser les frames, et le cas
  // cross-origin aussi, faute d'avoir à le tenter.
  allFrames: true,

  async main(ctx) {
    // Site exclu (réglages → Sites) : ni pastille ni bulle sur ce domaine.
    // ponytail: pas d'abonnement aux changements ici, contrairement à la
    // pastille — retirer un site ramène la bulle au prochain rechargement.
    if (isHidden(location.hostname, await loadHiddenSites())) return

    let captured: SelectionPayload | null = null
    /** Écouteurs de courte durée, actifs seulement quand la bulle est visible. */
    let watching: AbortController | null = null
    let pending = 0

    const theme = await loadUiPrefs()
    const bubble = createBubble((action) => {
      if (captured) void browser.runtime.sendMessage(message(action, captured))
      dismiss()
    }, theme.theme)
    const unsubscribeUiPrefs = onUiPrefsChanged((next) => bubble.setTheme(next.theme))

    /**
     * Le background demande la sélection quand l'utilisateur passe par le menu
     * contextuel : `info.selectionText` est aplati et tronqué par le navigateur,
     * ce chemin-ci rend les paragraphes et lit aussi les champs de formulaire.
     */
    browser.runtime.onMessage.addListener(
      (request: { type?: string }, _sender, sendResponse) => {
        if (request?.type !== GET_SELECTION) return
        sendResponse(capture()?.payload ?? null)
      }
    )

    // Trois écouteurs permanents, tous passifs ou quasi : rien qui recalcule à
    // chaque frappe ou à chaque mutation du DOM.
    ctx.addEventListener(document, "mouseup", schedule)
    ctx.addEventListener(document, "mousedown", onMouseDown)
    ctx.addEventListener(document, "keyup", onKeyUp)
    ctx.onInvalidated(() => {
      unsubscribeUiPrefs()
      dismiss()
    })

    function schedule() {
      // La sélection n'est arrêtée qu'après l'action par défaut du mouseup :
      // la lire dans le même tour renverrait l'état précédent.
      clearTimeout(pending)
      pending = ctx.setTimeout(refresh, 0)
    }

    function refresh() {
      const next = capture()
      if (!next) return dismiss()

      captured = next.payload
      bubble.show(next.rect)
      watch()
    }

    function dismiss() {
      clearTimeout(pending)
      captured = null
      watching?.abort()
      watching = null
      bubble.hide()
    }

    function onMouseDown(event: MouseEvent) {
      // Le shadow root est fermé : un clic dans la bulle est retargeté sur
      // l'hôte. Sans cette garde, la bulle disparaîtrait avant son propre clic.
      if (event.target === bubble.host) return
      dismiss()
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === "Escape") return dismiss()
      if (event.shiftKey && CARET_KEYS.has(event.key)) schedule()
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")
        schedule()
    }

    /** Un seul `abort()` suffit à tout retirer quand la bulle se referme. */
    function watch() {
      watching?.abort()
      const { signal } = (watching = new AbortController())
      document.addEventListener("scroll", dismiss, {
        capture: true,
        passive: true,
        signal,
      })
      window.addEventListener("blur", dismiss, { signal })
      document.addEventListener("visibilitychange", dismiss, { signal })
    }
  },
})

function message(
  action: SelectionAction,
  payload: SelectionPayload
): SelectionActionMessage {
  return { type: SELECTION_ACTION, action, ...payload }
}

/**
 * Lit la sélection courante et le rectangle où l'ancrer.
 *
 * Renvoie `null` dès que la sélection ne mérite pas d'action : vide, trop
 * courte, ou sans boîte à laquelle s'accrocher. Aucune exception ne remonte —
 * la page ne doit jamais casser à cause de l'extension.
 */
function capture() {
  const field = captureField()
  const raw = field ? field.text : captureDocument()
  const result = validateSelectionText(raw)
  if (!result.ok) return null

  const rect = field ? field.rect : selectionRect()
  if (!rect) return null

  return {
    rect,
    payload: {
      text: result.text,
      truncated: result.truncated,
      title: document.title,
      lang: document.documentElement.lang,
    } satisfies SelectionPayload,
  }
}

function captureDocument() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return ""

  const ranges = Array.from({ length: selection.rangeCount }, (_, index) =>
    selection.getRangeAt(index)
  )
  return rangesToText(ranges)
}

/**
 * `window.getSelection()` ne descend ni dans un `<input>` ni dans un
 * `<textarea>` : leur contenu ne se lit que par `selectionStart`/`selectionEnd`.
 * Faute de plage, la bulle s'ancre sur le champ lui-même.
 *
 * Les éditeurs `contenteditable` (Notion, CMS) passent par le chemin normal.
 * Google Docs peint son texte dans un canvas : rien n'est sélectionnable au sens
 * du DOM, la bulle ne s'affiche simplement pas.
 */
function captureField() {
  const element = document.activeElement
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  )
    return null

  try {
    const { selectionStart, selectionEnd, value } = element
    if (selectionStart == null || selectionStart === selectionEnd) return null
    return {
      text: value.slice(selectionStart, selectionEnd ?? undefined),
      rect: element.getBoundingClientRect(),
    }
  } catch {
    // `selectionStart` lève sur les types qui ne l'exposent pas (number, email).
    return null
  }
}

function selectionRect() {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null

  const rect = selection.getRangeAt(0).getBoundingClientRect()
  // Sélection dans un nœud sans boîte (élément remplacé, contenu replié) :
  // rectangle nul, rien à quoi s'accrocher.
  return rect.width || rect.height ? rect : null
}

/**
 * Styles de l'hôte.
 *
 * `all: initial` neutralise ce que la page impose par héritage — direction RTL,
 * transformations, filtres — et chaque déclaration est `!important` pour
 * résister aux feuilles de style agressives. `position: fixed` sort l'élément du
 * flux : la mise en page de la page hôte reste intacte.
 */
const HOST_STYLE =
  "all:initial!important;position:fixed!important;top:0!important;left:0!important;z-index:2147483647!important"

const BUBBLE_CSS = charteTokens("button") + `
button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  color: var(--foreground);
  background: var(--card);
  box-shadow: var(--shadow);
  cursor: pointer;
  white-space: nowrap;
  animation: appear 120ms ease-out;
  transition: opacity 100ms ease-out, transform 100ms ease-out, background-color 160ms var(--ease-out);
}
button + button { margin-left: 6px }
button:hover { background: color-mix(in srgb, var(--foreground) 8%, var(--card)) }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
/* Icône en masque plutôt qu'en emoji : rendu identique sur tous les OS, suit
   currentColor. Même mécanisme que la pastille (entrypoints/reader.content.ts). */
button[data-icon]::before {
  content: "";
  width: 15px;
  height: 15px;
  flex: none;
  background: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}
button[data-icon="headphones"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3'/%3E%3C/svg%3E");
}
@keyframes appear {
  from { opacity: 0; transform: scale(0.92) }
  to { opacity: 1; transform: none }
}
:host([data-state="hiding"]) button {
  opacity: 0;
  transform: scale(0.92);
}
@media (prefers-reduced-motion: reduce) {
  button {
    animation: none;
    transition: opacity 60ms ease-out;
  }
  :host([data-state="hiding"]) button {
    transform: none;
  }
}`

/**
 * Construit la bulle dans un shadow root fermé.
 *
 * L'isolation va dans les deux sens : le CSS de la page ne peut pas déformer le
 * bouton, et le nôtre ne peut pas fuir. Rien n'est construit par `innerHTML` :
 * seul du texte statique entre dans l'arbre, jamais la sélection.
 */
function createBubble(onAction: (action: SelectionAction) => void, initialTheme: ColorTheme) {
  const host = document.createElement("orateur-selection-bubble")
  host.style.cssText = HOST_STYLE
  applyTheme(initialTheme, host)

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = BUBBLE_CSS
  root.append(style)

  const buttons: HTMLButtonElement[] = []

  for (const action of ACTIONS) {
    const button = document.createElement("button")
    button.type = "button"
    // Résolu ici, pas dans ACTIONS : createBubble ne tourne qu'au vrai runtime
    // du content script, appelé depuis main() — voir le commentaire sur ACTIONS.
    button.dataset.icon = action.icon
    button.append(browser.i18n.getMessage(action.labelKey))
    // Un <button> natif porte déjà `role="button"`, la navigation clavier et
    // l'activation par Entrée/Espace ; l'`aria-label` remplace juste le libellé
    // court, illisible hors contexte au lecteur d'écran.
    button.setAttribute("aria-label", browser.i18n.getMessage(action.ariaLabelKey))
    // Le mousedown par défaut déplace le caret et efface la sélection avant que
    // le click ne parte.
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", () => onAction(action.id))
    root.append(button)
    buttons.push(button)
  }

  let hideTimeout: ReturnType<typeof setTimeout> | undefined

  // Detaches the host once the exit transition (or its fallback timer) fires.
  // Referenced by name (not an inline closure) so `show()` can always detach
  // it via `removeEventListener`, even mid fade-out.
  function finishHide() {
    clearTimeout(hideTimeout)
    host.removeEventListener("transitionend", finishHide)
    host.remove()
    delete host.dataset.state
  }

  return {
    host,

    show(rect: DOMRect) {
      // Cancel any exit in progress — a reselection mid fade-out must not
      // have the host removed out from under it.
      clearTimeout(hideTimeout)
      host.removeEventListener("transitionend", finishHide)
      delete host.dataset.state

      // `body` est absent d'un document XML ou SVG.
      if (!host.isConnected) (document.body ?? document.documentElement).append(host)

      // Mesure puis placement dans le même tour : le navigateur ne peint pas
      // entre les deux, donc aucun saut visible depuis le coin haut-gauche.
      //
      // C'est le contenu qui est mesuré, pas l'hôte : `all: initial` le laisse
      // sans marge ni bordure, donc les deux coins haut-gauche coïncident, mais
      // la largeur d'un `position: fixed` dépend du mode de calcul du
      // navigateur là où celle du bouton ne dépend que de son texte.
      const size = measure(buttons)
      const { top, left } = placeBubble(rect, size, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      host.style.setProperty("top", `${top}px`, "important")
      host.style.setProperty("left", `${left}px`, "important")
    },

    hide() {
      if (!host.isConnected || host.dataset.state === "hiding") return
      host.dataset.state = "hiding"
      host.addEventListener("transitionend", finishHide, { once: true })
      // Fallback in case transitionend never fires (e.g. the host is
      // disconnected some other way mid-transition) — 100ms transition +
      // 50ms safety margin.
      hideTimeout = setTimeout(finishHide, 150)
    },

    setTheme(theme: ColorTheme) {
      applyTheme(theme, host)
    },
  }
}

/** Les actions sont alignées sur une ligne : largeurs cumulées (+ la gouttière entre boutons), hauteur maximale. */
function measure(buttons: HTMLElement[]) {
  const rects = buttons.map((button) => button.getBoundingClientRect())
  return {
    width: rects.reduce((total, rect) => total + rect.width, 0) + 6 * (rects.length - 1),
    height: Math.max(...rects.map((rect) => rect.height)),
  }
}
