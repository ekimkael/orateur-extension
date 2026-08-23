/**
 * L'hôte Supertonic : un seul par navigateur (document offscreen sur Chrome,
 * page de fond sur Firefox — voir le fichier qui l'instancie), sur le modèle
 * de `speechSynthesis` que la pastille utilise déjà pour le moteur système.
 *
 * Ordonnancement porté de la version web (web/app/stores/synthesis.store.ts et
 * web/app/hooks/use-reading-session.ts), dont la lecture ne s'interrompt pas :
 *
 * - l'unité de synthèse est le CHUNK (un groupe de phrases, `chunkText`), pas
 *   le paragraphe entier — le premier son arrive après une phrase au lieu d'un
 *   paragraphe, et une attente résiduelle dure une phrase ;
 * - un CACHE d'URL de blobs, plafonné en LRU, remplace les deux créneaux
 *   jetables : il survit aux pauses, seuls `stop()` et une nouvelle lecture le
 *   vident ;
 * - une AVANCE de `LOOKAHEAD` unités au lieu d'une seule, remplie
 *   séquentiellement par `pump()` — une seule session ORT, deux synthèses de
 *   front ne feraient que se disputer le worker proxy.
 *
 * Les deux `<audio>` restent, en têtes de lecture alternées : l'unité suivante
 * est chargée sur la tête inactive pendant que l'autre joue, l'échange coûte
 * une frame plutôt qu'un rechargement. C'est aussi ce qui garde la vitesse
 * gratuite (`playbackRate`) là où le web resynthétise tout à chaque
 * changement — la vitesse fait partie de sa clé de cache, pas de la nôtre.
 *
 * ponytail : sur du matériel où le RTF (temps de synthèse / durée audio) est
 * supérieur à 1 — mesuré ~2,4 en phase 3 sur une machine de bureau ordinaire
 * — aucune profondeur d'avance ne peut empêcher les unités de prendre du
 * retard indéfiniment : une avance de k unités n'achète que k / (RTF - 1)
 * unités de lecture continue. La lecture attend alors la synthèse au lieu de
 * sauter ou de corrompre une unité : c'est le comportement honnête, pas un
 * bug. C'est WebGPU qui porte ce cas : `engine.ts` tente cet EP d'abord et ne
 * retombe sur WASM que là où il manque (Mac Intel, Linux, GPU blocklisté) —
 * seules ces machines-là gardent le hoquet. `synth()` logue le RTF mesuré :
 * le lire avant de toucher à `TOTAL_STEP` ou à `LOOKAHEAD`.
 *
 * Ni le titre ni l'introduction ne sont composés ici : c'est la responsabilité
 * de l'appelant (le code de câblage, pas ce module) — `tts-host.ts` ne connaît
 * ni les onglets ni `browser.*`, uniquement la synthèse et la lecture.
 */
import { loadModelFiles } from "./supertonic/model-cache.ts"
import {
  chunkText,
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

/** Une unité de synthèse : un chunk, et s'il termine son paragraphe. */
export interface Unit {
  text: string
  endsParagraph: boolean
}

/**
 * Découpe en unités de synthèse. `engine.synthesize()` appliquait déjà
 * `chunkText` en interne et enchaînait les chunks d'un même paragraphe en un
 * seul WAV : le premier son attendait donc la synthèse du paragraphe entier.
 * En sortant la découpe ici, l'ordonnanceur voit les chunks et joue le premier
 * dès qu'il est prêt. Mêmes bornes que le moteur pour que le texte donné à
 * `synthesize()` soit celui qu'il aurait produit lui-même.
 */
export function splitUnits(text: string, lang: SupportedLang): Unit[] {
  const maxLen = lang === "ko" || lang === "ja" ? 120 : 300
  const units: Unit[] = []
  for (const paragraph of splitBlocks(text)) {
    const chunks = chunkText(paragraph, maxLen)
    for (let i = 0; i < chunks.length; i++) {
      units.push({ text: chunks[i]!, endsParagraph: i === chunks.length - 1 })
    }
  }
  return units
}

const TOTAL_STEP = 8

/**
 * Silence de fin de paragraphe, en secondes. `engine.synthesize()` en insérait
 * autant entre deux chunks d'un même paragraphe ; ne le garder qu'aux
 * frontières de paragraphe rend la ponctuation de phrase à l'audio, qui la
 * porte déjà.
 */
const PARAGRAPH_PAUSE = 0.3

/**
 * ponytail : avance et plafond du cache en unités, pas en secondes — une
 * unité vaut au plus 300 caractères, soit ~20 s de parole, donc ~26 Mo de WAV
 * pour 8 entrées. Le plafond doit rester strictement supérieur à l'avance,
 * sinon `evict()` reprendrait ce que `pump()` vient de produire. Passer à un
 * budget en octets si la mémoire devient le facteur limitant.
 */
const LOOKAHEAD = 6
const CACHE_MAX = 8

/** Une tête de lecture. `unitIndex` vaut -1 quand elle ne porte aucune unité. */
interface Head {
  audio: HTMLAudioElement
  unitIndex: number
}

export interface TtsHost {
  speak(request: SpeakRequest): void
  control(action: TtsControlAction): void
  setSpeed(speed: number): void
}

export function createTtsHost(onState: (state: TtsState) => void): TtsHost {
  let enginePromise: Promise<TextToSpeech> | null = null
  const styles = new Map<SupertonicVoice, Promise<Style>>()

  let units: Unit[] = []
  let index = 0
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
   * Vrai entre "pause" et "resume". Distinct de `heads[active].audio.paused` :
   * une unité peut devenir prête pendant l'attente d'une autre, encore en
   * synthèse — `playUnit()` doit alors rester silencieux au lieu de repartir
   * tout seul.
   */
  let paused = false

  /** index d'unité → URL de blob prête à jouer. Ordre d'insertion = ordre de lecture. */
  const cache = new Map<number, string>()
  /** Synthèses en vol, pour dédoublonner `pump()` et l'attente de `advance()`. */
  const pending = new Map<number, Promise<void>>()
  let pumping = false

  function makeHead(slot: 0 | 1): Head {
    const audio = new Audio()
    audio.preservesPitch = true
    const head: Head = { audio, unitIndex: -1 }
    audio.addEventListener("ended", () => {
      // Un `ended` d'une tête qui n'est plus l'active est le résidu d'une
      // lecture arrêtée entre-temps — rien à avancer sur son compte.
      if (slot !== active) return
      void advance(generation)
    })
    audio.addEventListener("error", () => {
      // Même filtre que `ended`, plus `unitIndex < 0` : `stop()` vide `src` via
      // `removeAttribute` en libérant une tête, ce qui peut lever son propre
      // `error` — mais `unitIndex` est déjà remis à -1 avant, synchrone, donc
      // toujours vu par cette poignée avant l'événement (mis en file par le
      // navigateur, jamais immédiat).
      if (slot !== active || head.unitIndex < 0) return
      onState({ phase: "error", message: "Erreur de lecture audio.", reason: "audio-playback" })
    })
    return head
  }

  const heads: readonly [Head, Head] = [makeHead(0), makeHead(1)]

  function ensureEngine(): Promise<TextToSpeech> {
    if (!enginePromise) {
      enginePromise = (async () => {
        try {
          const getFile = await loadModelFiles((p) => {
            if (p.phase !== "downloading" && p.phase !== "checking") return
            const percent = Math.round(
              ((p.fileIndex + (p.bytesTotal ? p.bytesLoaded / p.bytesTotal : 0)) / p.totalFiles) * 100
            )
            onState({ phase: "loading", reason: "downloading-model", progress: percent })
          })
          onState({ phase: "loading", reason: "loading-engine" })
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

  /** Ajoute `PARAGRAPH_PAUSE` de silence à la fin d'un PCM. */
  function padSilence(pcm: Float32Array, sampleRate: number): Float32Array {
    const padded = new Float32Array(pcm.length + Math.floor(PARAGRAPH_PAUSE * sampleRate))
    padded.set(pcm, 0)
    return padded
  }

  /**
   * N'évince que des unités DÉJÀ LUES : révoquer l'URL de l'unité en cours ou
   * d'une unité que `pump()` vient de préparer reviendrait à refaire le travail
   * — ou pire, à couper la tête qui la joue.
   */
  function evict() {
    while (cache.size > CACHE_MAX) {
      let victim = -1
      for (const k of cache.keys()) {
        if (k < index) {
          victim = k
          break
        }
      }
      if (victim < 0) return
      URL.revokeObjectURL(cache.get(victim)!)
      cache.delete(victim)
    }
  }

  function clearCache() {
    for (const url of cache.values()) URL.revokeObjectURL(url)
    cache.clear()
    pending.clear()
  }

  /** Synthétise l'unité `i` dans le cache, sans la jouer. Dédoublonne les appels concurrents. */
  function synth(gen: number, i: number): Promise<void> {
    if (cache.has(i)) return Promise.resolve()
    const inflight = pending.get(i)
    if (inflight) return inflight
    const unit = units[i]
    if (!unit) return Promise.resolve()

    const p = (async () => {
      const engine = await ensureEngine()
      if (gen !== generation) return
      const t0 = performance.now()
      const pcm = await engine.synthesize(
        unit.text, currentLang, currentStyle!, TOTAL_STEP, 1.0, abort?.signal
      )
      if (gen !== generation) return
      // Le seul chiffre qui dit si la lecture tiendra : au-dessus de 1, l'avance
      // se vide et `advance()` finit par attendre (voir l'en-tête du fichier).
      // Seuil, pas `> 0` : sous une demi-seconde d'audio le rapport est dominé
      // par les frais fixes d'un run et ne dit plus rien de la tenue en lecture.
      const seconds = pcm.length / engine.sampleRate
      if (seconds >= 0.5) {
        const ms = performance.now() - t0
        console.debug(
          `[orateur] unité ${i} : ${Math.round(ms)} ms pour ${seconds.toFixed(1)} s d'audio — RTF ${(ms / 1000 / seconds).toFixed(2)}`
        )
      }
      const wav = writeWavFile(unit.endsParagraph ? padSilence(pcm, engine.sampleRate) : pcm, engine.sampleRate)
      const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }))
      // La génération a pu tourner pendant la création du blob : sans ce
      // second contrôle, l'URL n'entrerait plus dans aucun cache et fuirait.
      if (gen !== generation) {
        URL.revokeObjectURL(url)
        return
      }
      cache.set(i, url)
      evict()
    })()

    pending.set(i, p)
    // `.catch` sur la chaîne dérivée, pas sur `p` : `finally` propage le rejet,
    // et cette branche-ci n'a pas d'attendant. Celui qui a demandé la synthèse
    // garde `p` tel quel et voit l'erreur.
    void p
      .finally(() => {
        if (pending.get(i) === p) pending.delete(i)
      })
      .catch(() => {})
    return p
  }

  /**
   * Remplit le cache jusqu'à `LOOKAHEAD` unités devant la lecture, une à la
   * fois. Une seule boucle à la fois : deux `engine.synthesize()` de front se
   * disputeraient le worker proxy ORT au lieu d'aller plus vite (le web s'en
   * protège autrement, en faisant attendre la lecture sur son store).
   */
  async function pump(gen: number) {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        if (gen !== generation) return
        let target = -1
        const end = Math.min(index + 1 + LOOKAHEAD, units.length)
        for (let i = index; i < end; i++) {
          if (!cache.has(i) && !pending.has(i)) {
            target = i
            break
          }
        }
        if (target < 0) return
        await synth(gen, target)
        if (gen !== generation) return
        preloadNext()
        // Rend la main au thread entre deux unités : sans ça, Firefox signale
        // un thread bloqué (même raison que le setTimeout(0) du web, dans
        // synthesis.store.ts).
        await new Promise((r) => setTimeout(r, 0))
      }
    } catch {
      // Une synthèse en échec est déjà signalée par qui l'attendait
      // (`advance`/`speak`) ; l'avance, elle, retentera au prochain tour.
    } finally {
      pumping = false
    }
  }

  function load(slot: 0 | 1, i: number) {
    const head = heads[slot]
    if (head.unitIndex === i) return
    head.unitIndex = i
    head.audio.src = cache.get(i)!
    head.audio.playbackRate = speed
  }

  /** Charge l'unité suivante sur la tête inactive pour que l'échange coûte une frame. */
  function preloadNext() {
    const next = index + 1
    if (!cache.has(next)) return
    if (heads[0].unitIndex === next || heads[1].unitIndex === next) return
    load((1 - active) as 0 | 1, next)
  }

  function playUnit(gen: number, i: number) {
    if (gen !== generation) return
    if (!cache.has(i)) return
    const slot: 0 | 1 =
      heads[0].unitIndex === i ? 0 : heads[1].unitIndex === i ? 1 : ((1 - active) as 0 | 1)
    load(slot, i)
    active = slot
    index = i
    if (paused) {
      // L'unité vient de finir sa synthèse pendant qu'on l'attendait en
      // pause : rester silencieux plutôt que repartir tout seul — c'est
      // `control("resume")` qui prendra le relais.
      onState({ phase: "paused" })
      return
    }
    onState({ phase: "playing", block: i, total: units.length })
    heads[slot].audio.play().catch((e: unknown) => {
      if (gen !== generation) return
      onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
    })
    preloadNext()
  }

  async function advance(gen: number) {
    if (gen !== generation) return
    try {
      const next = index + 1
      if (next >= units.length) {
        onState({ phase: "ended" })
        return
      }
      // N'arrive que si la synthèse n'a pas eu le temps d'avance sur la
      // lecture (RTF > 1, voir l'en-tête du fichier) : l'unité suivante n'est
      // pas encore prête, il faut l'attendre en silence sinon.
      if (!cache.has(next)) {
        onState({ phase: "loading", reason: "preparing-next" })
        await synth(gen, next)
        if (gen !== generation) return
      }
      playUnit(gen, next)
      void pump(gen)
    } catch (e) {
      if (gen !== generation) return // stop() a déjà tout nettoyé, résidu attendu
      onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  function speak(request: SpeakRequest) {
    const gen = ++generation
    abort?.abort()
    abort = new AbortController()
    units = splitUnits(request.text, request.lang)
    index = 0
    speed = request.speed
    currentLang = request.lang
    currentStyle = null
    paused = false

    // Une nouvelle lecture ne doit jamais hériter de l'audio d'une lecture
    // précédente : les indices d'unité ne sont uniques qu'À L'INTÉRIEUR d'une
    // même session — l'unité 0 d'un article n'a rien à voir avec l'unité 0
    // d'un autre. Sans cette purge, le cache servirait le mauvais audio, à la
    // mauvaise vitesse.
    clearCache()
    for (const h of heads) {
      h.audio.pause()
      h.unitIndex = -1
    }

    void (async () => {
      try {
        if (units.length === 0) {
          onState({ phase: "ended" })
          return
        }
        onState({ phase: "loading", reason: "loading-voice" })
        const style = await ensureStyle(request.voice)
        if (gen !== generation) return
        currentStyle = style
        void pump(gen)
        // Dédoublonné avec la première cible de `pump()` : c'est la même
        // promesse, pas une seconde synthèse.
        await synth(gen, 0)
        if (gen !== generation) return
        playUnit(gen, 0)
      } catch (e) {
        if (gen !== generation) return
        onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
      }
    })()
  }

  function control(action: TtsControlAction) {
    if (action === "pause") {
      paused = true
      heads[active].audio.pause()
      onState({ phase: "paused" })
      return
    }
    if (action === "resume") {
      paused = false
      // La tête active a pu déjà finir pendant que la transition suivante
      // était en vol (RTF > 1, voir l'en-tête du fichier) : `play()` sur un
      // <audio> déjà `ended` le repartirait de zéro plutôt que de le
      // reprendre, rejouant l'unité qui vient de finir et déclenchant un
      // second `ended` — donc un second `advance()` pour la même transition.
      // Rien à reprendre ici : `advance()` mènera lui-même à l'unité suivante —
      // ou, si l'unité a fini de synthétiser pendant la pause, `playUnit()`
      // l'a déjà chargée sans la jouer (voir son test sur `paused`) : ni finie
      // ni en cours, `ended` y est faux, donc on tombe bien après ce retour
      // et `play()` plus bas la démarre.
      if (heads[active].audio.ended) return
      const gen = generation
      heads[active].audio.play().catch((e: unknown) => {
        if (gen !== generation) return
        onState({ phase: "error", message: e instanceof Error ? e.message : String(e) })
      })
      onState({ phase: "playing", block: index, total: units.length })
      return
    }
    // "stop" : une nouvelle génération invalide toute promesse en vol, sans
    // attendre qu'elle se termine — c'est ce qui rend l'arrêt réel pendant
    // une synthèse, pas seulement pendant la lecture.
    generation++
    abort?.abort()
    paused = false
    for (const h of heads) {
      h.unitIndex = -1
      h.audio.pause()
      h.audio.removeAttribute("src")
    }
    clearCache()
    units = []
    index = 0
  }

  function setSpeed(newSpeed: number) {
    speed = newSpeed
    for (const h of heads) h.audio.playbackRate = newSpeed
  }

  return { speak, control, setSpeed }
}
