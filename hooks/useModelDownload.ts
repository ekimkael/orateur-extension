import { useEffect, useState } from "react"
import { isCacheWritable } from "../lib/supertonic/model-cache"
import {
  MODEL_DOWNLOAD_CANCEL,
  MODEL_DOWNLOAD_REQUEST,
  MODEL_PROGRESS,
  MODEL_STATE_QUERY,
  type ModelProgressMessage,
} from "../lib/tts-messages"

export type ModelDownloadPhase = "unavailable" | "idle" | "downloading" | "error"

export interface UseModelDownload {
  phase: ModelDownloadPhase
  loaded: number
  total: number
  message?: string
  start(): void
  cancel(): void
  /** Alias sémantique de `start` pour l'état "error" — model-cache.ts saute
   *  déjà les fichiers présents, donc reprendre et relancer sont un seul et
   *  même appel. */
  retry(): void
}

interface StoredState {
  phase: "idle" | "downloading" | "error"
  loaded?: number
  total?: number
  message?: string
}

/**
 * État TRANSITOIRE du téléchargement — pas "le modèle est-il complet",
 * qu'App.tsx connaît déjà via `getModelCacheSize()`. `onDone` est appelé une
 * fois à la fin d'un téléchargement réussi pour que l'appelant rafraîchisse
 * cette taille, plutôt que de la dupliquer ici.
 */
export function useModelDownload(onDone?: () => void): UseModelDownload {
  const [state, setState] = useState<StoredState>({ phase: "idle" })
  const [writable, setWritable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false

    void isCacheWritable().then((ok) => {
      if (!cancelled) setWritable(ok)
    })

    // Rattrape un téléchargement déjà en cours (lancé depuis un autre onglet
    // options, ou avant que celui-ci ne soit ouvert) : l'hôte répond avec son
    // état réel, cf. offscreen/main.ts et background.ts.
    void browser.runtime
      .sendMessage({ type: MODEL_STATE_QUERY })
      .then((s: StoredState | { phase: "done" } | undefined) => {
        if (cancelled || !s) return
        if (s.phase === "done") return // transitoire, jamais l'état stable
        setState(s)
      })
      .catch(() => {})

    function onMessage(message: Partial<ModelProgressMessage>) {
      if (message?.type !== MODEL_PROGRESS || !message.state) return
      const next = message.state
      if (next.phase === "done") {
        setState({ phase: "idle" })
        onDone?.()
        return
      }
      // `next` reste typé ModelProgressState (phase inclut "done") même après
      // le garde ci-dessus : ModelProgressState n'est pas une union
      // discriminée, seul `next.phase` se rétrécit à l'usage — donc on
      // reconstruit plutôt que de repasser l'objet entier.
      setState({ phase: next.phase, loaded: next.loaded, total: next.total, message: next.message })
    }
    browser.runtime.onMessage.addListener(onMessage)

    return () => {
      cancelled = true
      browser.runtime.onMessage.removeListener(onMessage)
    }
    // `onDone` volontairement hors dépendances : un changement de référence
    // (App.tsx re-rendu) ne doit pas réabonner ce listener.
  }, [])

  return {
    phase: writable === false ? "unavailable" : state.phase,
    loaded: state.loaded ?? 0,
    total: state.total ?? 0,
    message: state.message,
    start: () => void browser.runtime.sendMessage({ type: MODEL_DOWNLOAD_REQUEST }).catch(() => {}),
    retry: () => void browser.runtime.sendMessage({ type: MODEL_DOWNLOAD_REQUEST }).catch(() => {}),
    cancel: () => void browser.runtime.sendMessage({ type: MODEL_DOWNLOAD_CANCEL }).catch(() => {}),
  }
}
