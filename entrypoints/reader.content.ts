/**
 * Lecture de l'article directement sur la page, via la synthèse vocale native
 * du navigateur (`speechSynthesis`) — pas d'appel réseau, pas de dépendance.
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

interface ReaderHost extends HTMLElement {
  orateurStop?: () => void
}

export default defineContentScript({
  // Injecté à la demande par le background, comme l'extracteur : pas de
  // permission d'hôte large à justifier.
  registration: "runtime",
  main(ctx) {
    // Une lecture déjà en cours sur cette page (clic répété sur le menu) : on
    // l'arrête avant d'en démarrer une nouvelle plutôt que de les superposer.
    const previous = document.querySelector<ReaderHost>("orateur-reader-bar")
    previous?.orateurStop?.()

    let bar: ReturnType<typeof createBar> | null = null

    browser.runtime.onMessage.addListener(onMessage)
    ctx.onInvalidated(stop)

    function onMessage(message: Partial<StartReadingMessage>) {
      if (message?.type !== START_READING || !message.text) return
      start(message as ReadPagePayload)
    }

    function start(payload: ReadPagePayload) {
      speechSynthesis.cancel()
      const queue = toUtterances(payload)
      if (!queue.length) return

      bar = createBar(payload.title, togglePause, stop)
      bar.host.orateurStop = stop
      // ponytail: la fin n'est détectée que sur le dernier bloc — si celui-ci
      // erre au lieu de finir, la barre reste affichée jusqu'au clic sur stop.
      const last = queue.at(-1)
      last?.addEventListener("end", stop)
      for (const utterance of queue) speechSynthesis.speak(utterance)
    }

    function togglePause() {
      if (speechSynthesis.paused) speechSynthesis.resume()
      else speechSynthesis.pause()
      bar?.setPaused(speechSynthesis.paused)
    }

    function stop() {
      browser.runtime.onMessage.removeListener(onMessage)
      speechSynthesis.cancel()
      bar?.remove()
      bar = null
    }
  },
})

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

const BAR_CSS = `
div {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
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
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}
button:hover { background: rgb(255 255 255 / 0.12) }
button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px }
span {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

/**
 * Barre flottante minimale : play/pause et stop, dans un shadow root fermé —
 * même isolation que la bulle de sélection, pour les mêmes raisons.
 */
function createBar(
  title: string | undefined,
  onToggle: () => void,
  onStop: () => void
) {
  const host = document.createElement("orateur-reader-bar") as ReaderHost
  host.style.cssText = HOST_STYLE

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = BAR_CSS
  root.append(style)

  const row = document.createElement("div")

  const toggleButton = document.createElement("button")
  toggleButton.type = "button"
  toggleButton.textContent = "⏸"
  toggleButton.setAttribute("aria-label", "Mettre en pause")
  toggleButton.addEventListener("click", onToggle)
  row.append(toggleButton)

  if (title) {
    const label = document.createElement("span")
    label.textContent = title
    row.append(label)
  }

  const stopButton = document.createElement("button")
  stopButton.type = "button"
  stopButton.textContent = "⏹"
  stopButton.setAttribute("aria-label", "Arrêter la lecture")
  stopButton.addEventListener("click", onStop)
  row.append(stopButton)

  root.append(row)
  ;(document.body ?? document.documentElement).append(host)

  return {
    host,
    setPaused(paused: boolean) {
      toggleButton.textContent = paused ? "▶" : "⏸"
      toggleButton.setAttribute(
        "aria-label",
        paused ? "Reprendre la lecture" : "Mettre en pause"
      )
    },
    remove() {
      host.remove()
    },
  }
}
