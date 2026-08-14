/**
 * L'hôte Supertonic : un seul par navigateur (document offscreen sur Chrome,
 * page de fond sur Firefox — voir le fichier qui l'instancie), sur le modèle
 * de `speechSynthesis` que la pastille utilise déjà pour le moteur système.
 *
 * File de blocs avec préchargement d'un bloc d'avance, lecture par deux
 * `<audio>` en alternance : le bloc N+1 se synthétise sur l'élément inactif
 * pendant que N joue, l'échange sur `ended` coûte une frame plutôt qu'un
 * rechargement.
 *
 * ponytail : sur du matériel où le RTF (temps de synthèse / durée audio) est
 * supérieur à 1 — mesuré ~2,4 en phase 3 sur une machine de bureau ordinaire
 * — aucune profondeur de préchargement fixe ne peut empêcher les blocs de
 * prendre du retard indéfiniment. La lecture attend alors la synthèse au
 * lieu de sauter ou de corrompre un bloc : c'est le comportement honnête, pas
 * un bug. Accélérer la synthèse (moins de pas de diffusion, WebGPU) reste à
 * explorer si ça devient gênant en usage réel.
 *
 * Ni le titre ni l'introduction ne sont composés ici : c'est la responsabilité
 * de l'appelant (le code de câblage, pas ce module) — `tts-host.ts` ne connaît
 * ni les onglets ni `browser.*`, uniquement la synthèse et la lecture.
 */
import { loadModelFiles } from "./supertonic/model-cache.ts"
import {
  loadTextToSpeechEngine,
  loadVoiceStyle,
  writeWavFile,
  type Style,
  type TextToSpeech,
} from "./supertonic/engine.ts"
import type { SupertonicVoice } from "./supertonic/types.ts"
import type { SupportedLang } from "./supertonic-lang.ts"
import type { TtsControlAction, TtsState } from "./tts-messages.ts"

export interface SpeakRequest {
  text: string
  lang: SupportedLang
  voice: SupertonicVoice
  speed: number
}

/** Un bloc par paragraphe — même découpe que le chemin système (reader.content.ts). */
export function splitBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

const TOTAL_STEP = 8

interface Slot {
  audio: HTMLAudioElement
  /** -1 : vide. */
  blockIndex: number
  url: string | null
  /** Synthèse en cours pour ce créneau, si `blockIndex` n'est pas encore prêt. */
  pending: Promise<void> | null
}

export interface TtsHost {
  speak(request: SpeakRequest): void
  control(action: TtsControlAction): void
  setSpeed(speed: number): void
}

export function createTtsHost(onState: (state: TtsState) => void): TtsHost {
  let enginePromise: Promise<TextToSpeech> | null = null
  const styles = new Map<SupertonicVoice, Promise<Style>>()

  let blocks: string[] = []
  let blockIndex = 0
  let speed = 1
  let currentLang: SupportedLang = "fr"
  let currentStyle: Style | null = null
  /**
   * Incrémenté à chaque `speak()`/`stop()` : une promesse d'une génération
   * révolue devient un no-op à son retour, plutôt que d'agir sur l'état de
   * la lecture suivante. Même mécanisme que `generation` dans reader.content.ts.
   */
  let generation = 0
  let abort: AbortController | null = null
  let active: 0 | 1 = 0
  /**
   * Vrai entre "pause" et "resume". Distinct de `slots[active].audio.paused` :
   * un bloc peut devenir prêt (fill() résolu) pendant l'attente d'un autre,
   * encore en synthèse — `playSlot()` doit alors rester silencieux au lieu de
   * repartir tout seul.
   */
  let paused = false

  function makeSlot(index: 0 | 1): Slot {
    const audio = new Audio()
    audio.preservesPitch = true
    const slot: Slot = { audio, blockIndex: -1, url: null, pending: null }
    audio.addEventListener("ended", () => {
      // Un `ended` d'un créneau qui n'est plus l'actif est le résidu d'une
      // lecture arrêtée entre-temps — rien à avancer sur son compte.
      if (index !== active) return
      void advance(generation)
    })
    audio.addEventListener("error", () => {
      // Même filtre que `ended`, plus `!slot.url` : `stop()` et `fill()` vident
      // `src` via `removeAttribute` en repurposant un créneau, ce qui peut
      // lever son propre `error` — mais `url` est déjà remis à `null` avant,
      // synchrone, donc toujours vu par cette poignée avant l'événement
      // (mis en file par le navigateur, jamais immédiat).
      if (index !== active || !slot.url) return
      onState({ phase: "error", message: "Erreur de lecture audio." })
    })
    return slot
  }

  const slots: readonly [Slot, Slot] = [makeSlot(0), makeSlot(1)]

  function ensureEngine(): Promise<TextToSpeech> {
    if (!enginePromise) {
      enginePromise = (async () => {
        try {
          const getFile = await loadModelFiles((p) => {
            if (p.phase !== "downloading" && p.phase !== "checking") return
            const percent = Math.round(
              ((p.fileIndex + (p.bytesTotal ? p.bytesLoaded / p.bytesTotal : 0)) / p.totalFiles) * 100
            )
            onState({ phase: "loading", label: `Téléchargement… ${percent}%` })
          })
          onState({ phase: "loading", label: "Chargement du moteur…" })
          const engine = await loadTextToSpeechEngine(getFile)
          // Échauffement une fois pour toutes les lectures à venir — voir la
          // découverte de la phase 0a : le premier run() de chaque session
          // coûte des secondes, payés ici plutôt que sur le premier ▶.
          const warmupStyle = await ensureStyle("F1")
          await engine.synthesize("Bonjour.", "fr", warmupStyle, TOTAL_STEP, 1.0)
          return engine
        } catch (e) {
          // Permet un nouvel essai au prochain speak() plutôt que de rejeter
          // indéfiniment la même promesse mémoïsée.
          enginePromise = null
          throw e
        }
      })()
    }
    return enginePromise
  }

  function ensureStyle(voice: SupertonicVoice): Promise<Style> {
    let p = styles.get(voice)
    if (!p) {
      p = loadVoiceStyle(voice).catch((e: unknown) => {
        styles.delete(voice)
        throw e
      })
      styles.set(voice, p)
    }
    return p
  }

  /** Synthétise le bloc `index` dans `slot`, sans le jouer. Dédoublonne les appels concurrents. */
  function fill(gen: number, slot: 0 | 1, index: number, style: Style, lang: SupportedLang): Promise<void> {
    const s = slots[slot]
    if (s.blockIndex === index && s.url) return Promise.resolve()
    if (s.blockIndex === index && s.pending) return s.pending

    // Le créneau change de bloc : son URL ne doit plus jamais paraître prête
    // tant que la nouvelle synthèse n'a pas abouti. Sinon, un `advance()` qui
    // tombe pendant cette synthèse voit encore `blockIndex` à jour et `url`
    // non vide (celle de l'ANCIEN bloc) — les deux gardes ci-dessus le
    // croient prêt, et `playSlot()` joue l'audio périmé du créneau.
    if (s.url) {
      URL.revokeObjectURL(s.url)
      s.url = null
      s.audio.removeAttribute("src")
    }

    const text = blocks[index]
    const p = (async () => {
      if (text === undefined) return
      const engine = await ensureEngine()
      if (gen !== generation) return
      const pcm = await engine.synthesize(text, lang, style, TOTAL_STEP, 1.0, abort?.signal)
      if (gen !== generation) return
      const wav = writeWavFile(pcm, engine.sampleRate)
      s.url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }))
      s.audio.src = s.url
      s.audio.playbackRate = speed
    })()

    s.blockIndex = index
    s.pending = p
    void p.finally(() => {
      if (s.pending === p) s.pending = null
    })
    return p
  }

  function playSlot(gen: number, slot: 0 | 1) {
    if (gen !== generation) return
    active = slot
    blockIndex = slots[slot].blockIndex
    if (paused) {
      // Le bloc vient de finir sa synthèse pendant qu'on l'attendait en
      // pause : rester silencieux plutôt que repartir tout seul — c'est
      // `control("resume")` qui prendra le relais.
      onState({ phase: "paused" })
      return
    }
    onState({ phase: "playing", block: blockIndex, total: blocks.length })
    slots[slot].audio.play().catch((e: unknown) => {
      if (gen !== generation) return
      onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
    })
  }

  async function advance(gen: number) {
    if (gen !== generation) return
    try {
      const next = blockIndex + 1
      if (next >= blocks.length) {
        onState({ phase: "ended" })
        return
      }
      const freedSlot = active
      const otherSlot = ((1 - active) as 0 | 1)
      const style = currentStyle!

      const alreadyReady = slots[otherSlot].blockIndex === next && slots[otherSlot].url
      if (!alreadyReady) onState({ phase: "loading" })
      await fill(gen, otherSlot, next, style, currentLang)
      if (gen !== generation) return
      playSlot(gen, otherSlot)

      // Précharge le bloc suivant celui-là dans le créneau désormais libre.
      void fill(gen, freedSlot, next + 1, style, currentLang).catch(() => {})
    } catch (e) {
      if (gen !== generation) return // stop() a déjà tout nettoyé, résidu attendu
      onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  function speak(request: SpeakRequest) {
    const gen = ++generation
    abort?.abort()
    abort = new AbortController()
    blocks = splitBlocks(request.text)
    blockIndex = 0
    speed = request.speed
    currentLang = request.lang
    currentStyle = null
    paused = false

    // Une nouvelle lecture ne doit jamais hériter de l'audio d'une lecture
    // précédente : les indices de bloc ne sont uniques qu'À L'INTÉRIEUR d'une
    // même session — le bloc 0 d'un article n'a rien à voir avec le bloc 0
    // d'un autre. Sans cette purge, `fill()` croirait le créneau déjà prêt
    // (même index, plus vieux texte) et jouerait le mauvais audio, à la
    // mauvaise vitesse.
    for (const s of slots) {
      s.audio.pause()
      if (s.url) URL.revokeObjectURL(s.url)
      s.url = null
      s.blockIndex = -1
      s.pending = null
    }

    void (async () => {
      try {
        if (blocks.length === 0) {
          onState({ phase: "ended" })
          return
        }
        onState({ phase: "loading" })
        const style = await ensureStyle(request.voice)
        if (gen !== generation) return
        currentStyle = style
        await fill(gen, 0, 0, style, request.lang)
        if (gen !== generation) return
        playSlot(gen, 0)
        void fill(gen, 1, 1, style, request.lang).catch(() => {})
      } catch (e) {
        if (gen !== generation) return
        onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
      }
    })()
  }

  function control(action: TtsControlAction) {
    if (action === "pause") {
      paused = true
      slots[active].audio.pause()
      onState({ phase: "paused" })
      return
    }
    if (action === "resume") {
      paused = false
      // Le créneau actif a pu déjà finir pendant que la transition suivante
      // était en vol (RTF > 1, voir l'en-tête du fichier) : `play()` sur un
      // <audio> déjà `ended` le repartirait de zéro plutôt que de le
      // reprendre, rejouant le bloc qui vient de finir et déclenchant un
      // second `ended` — donc un second `advance()` pour la même transition.
      // Rien à reprendre ici : `advance()` mènera lui-même au bloc suivant —
      // ou, si le bloc a fini de synthétiser pendant la pause, `playSlot()`
      // l'a déjà chargé sans le jouer (voir son test sur `paused`) : ni fini
      // ni en cours, `ended` y est faux, donc on tombe bien après ce retour
      // et `play()` plus bas le démarre.
      if (slots[active].audio.ended) return
      const gen = generation
      slots[active].audio.play().catch((e: unknown) => {
        if (gen !== generation) return
        onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
      })
      onState({ phase: "playing", block: blockIndex, total: blocks.length })
      return
    }
    // "stop" : une nouvelle génération invalide toute promesse en vol, sans
    // attendre qu'elle se termine — c'est ce qui rend l'arrêt réel pendant
    // une synthèse, pas seulement pendant la lecture.
    generation++
    abort?.abort()
    paused = false
    for (const s of slots) {
      s.audio.pause()
      s.audio.removeAttribute("src")
      if (s.url) URL.revokeObjectURL(s.url)
      s.url = null
      s.blockIndex = -1
      s.pending = null
    }
    blocks = []
    blockIndex = 0
  }

  function setSpeed(newSpeed: number) {
    speed = newSpeed
    for (const s of slots) s.audio.playbackRate = newSpeed
  }

  return { speak, control, setSpeed }
}
