/**
 * One tab's reading: picks the engine, keeps the shown position, saves
 * progress, counts telemetry and tells the view what to show. It never builds
 * DOM: the pill, the follower and the page are handed in, so the whole state
 * machine runs under `node --test`.
 */

import type { ReaderEngine, ReaderPreferences } from "./reader-prefs"
import { loadPronunciationRules } from "./pronunciation-rules.ts"
import type { PronunciationRule } from "./pronunciation/personal.ts"
import type { createLivePage } from "./live-page.ts"
import type { SupportedLang } from "./supertonic-lang.ts"
import { resolveDocLang } from "./detect-lang.ts"
import { markTab } from "./tab-title.ts"
import type { Player, PlayerEvent, ReadFailure } from "./player.ts"
import { cancelSpeech, createSystemPlayer } from "./system-player.ts"
import { createSupertonicPlayer } from "./supertonic-player.ts"
import { MODEL_CACHE_QUERY, TTS_PREPARE_BLOCK, type TtsLoadingReason } from "./tts-messages.ts"
import { NOTIFY, READ_PAGE, READER_TOKEN, type NotifyMessage, type ReadPagePayload } from "./reader-messages.ts"
import { track } from "./telemetry.ts"
import { moveReadingBlock } from "./reading-navigation.ts"
import { clearReadingProgress, loadReadingProgress, saveReadingProgress } from "./reading-progress.ts"

type LivePage = ReturnType<typeof createLivePage>

export type ReaderViewState = "idle" | "loading" | "playing" | "paused" | "error"

export interface LoadingInfo {
  label: string
  percent?: number
  reason?: TtsLoadingReason
}

/** The pill, as the session sees it. */
export interface ReaderView {
  setState(state: ReaderViewState, title?: string, interruptible?: boolean, loading?: LoadingInfo): void
  setPosition(block: number, total: number): void
  attach(): void
  /** Resolves once the running transition ends, or is cancelled by the next one. */
  settled(): Promise<void>
}

/** Highlights the paragraph being read in the page. */
export interface ReadingFollower {
  begin(paragraphs: string[], anchors?: readonly (Element | null)[]): void
  show(block: number): void
  end(): void
}

/** What only the page itself can answer. */
export interface ReadingPage {
  /** Re-reads each paragraph from the live DOM, for pages the browser may translate. */
  liveSource(paragraphs: string[]): LivePage
  /** The address progress is saved under. */
  url(): string
  /** Paragraph under the last right-click, or -1. */
  contextBlock(paragraphs: string[]): number
  confirmResume(): boolean
}

export interface ReadingSessionOptions {
  token: string
  view: ReaderView
  follower: ReadingFollower
  page: ReadingPage
  /** Read at each use: a reading follows settings changed meanwhile. */
  prefs: () => ReaderPreferences
}

export type ReadingSession = ReturnType<typeof createReadingSession>

export function createReadingSession({ token, view, follower, page, prefs }: ReadingSessionOptions) {
  let reading = false
  let paused = false
  /** The engine of the current reading; it alone knows where the voice is. */
  let player: Player | null = null
  /** Paragraph shown by the pill, the base for previous/next. */
  let blockIndex = 0
  let pageSource: LivePage | null = null
  let startGeneration = 0
  let readingUrl = ""
  /** Réinjecté à chaque `playing` : un état de chargement y écrit la
   *  progression du téléchargement par-dessus, il faut de quoi le restaurer. */
  let readingTitle = ""
  let readingTotal = 0
  let readingTelemetryStarted = false
  let readingTelemetryFailed = false

  /** What the engine reports drives the pill, whichever engine it is. */
  function onPlayerEvent(engine: ReaderEngine, event: PlayerEvent) {
    if (event.phase === "loading") {
      // Keep preparation and download feedback inside the compact pill.
      const label = event.reason ? browser.i18n.getMessage(LOADING_REASON_KEY[event.reason]) : undefined
      view.setState(
        "loading",
        readingTitle,
        true,
        label ? { label, percent: event.progress, reason: event.reason } : undefined
      )
    } else if (event.phase === "playing") {
      trackReadingStarted(engine)
      paused = false
      blockIndex = event.block
      void persistProgress(event.block)
      follower.show(event.block)
      view.setPosition(event.block, event.total)
      view.setState("playing", readingTitle)
    } else if (event.phase === "paused") {
      paused = true
      view.setState("paused")
    } else if (event.phase === "ended") {
      trackReadingCompleted(engine)
      void clearReadingProgress(readingUrl)
      fold()
    } else if (event.phase === "error") {
      trackReadingFailed(engine, event.reason)
      if (event.recoverable) return
      if (event.message) {
        void browser.runtime.sendMessage({ type: NOTIFY, message: event.message } satisfies NotifyMessage)
      }
      fold()
      view.setState("error", readingTitle)
    }
  }

  /** ▶ lance la lecture, ⏸/▶ la met en pause et la reprend. */
  async function toggle() {
    if (reading) {
      paused = !paused
      if (paused) player?.pause()
      else player?.resume()
      // Retour immédiat : l'événement que Supertonic renvoie ensuite ne fait
      // que confirmer le même état, sans le faire attendre.
      view.setState(paused ? "paused" : "playing")
      return
    }

    view.setState("loading")
    // Un rejet (background endormi, onglet non injectable) vaut un échec :
    // sans ça la pastille resterait bloquée sur son état d'attente.
    const started = await browser.runtime
      .sendMessage({ type: READ_PAGE })
      .catch(() => false)
    // La réponse peut arriver après START_READING : ne redescendre à l'état
    // replié que si rien n'a démarré.
    if (!started && !reading) view.setState("error", document.title)
  }

  /** Précédent vise toujours le paragraphe précédent ; suivant, le suivant. */
  function navigate(delta: -1 | 1) {
    if (!reading) return
    const target = moveReadingBlock(blockIndex, readingTotal, delta)
    if (target != null) seekTo(target)
  }

  function seekTo(block: number) {
    if (block < 0 || block >= readingTotal) return
    blockIndex = block
    follower.show(block)
    view.setPosition(block, readingTotal)
    void persistProgress(block)
    player?.seek(block)
  }

  /** Choisit le moteur, puis démarre — le reste ne se recroise plus. */
  async function start(payload: ReadPagePayload, fromHere = false) {
    const mine = ++startGeneration
    const paragraphs = splitParagraphs(payload.text)
    const total = paragraphs.length
    if (!total) return fold()
    const source = payload.livePage ? page.liveSource(paragraphs) : null
    let personalRules: PronunciationRule[]
    try {
      personalRules = await loadPronunciationRules()
    } catch {
      if (mine === startGeneration) view.setState("error", payload.title ?? "")
      return
    }
    if (mine !== startGeneration) return
    const url = page.url()
    const title = payload.title ?? ""
    const targetBlock = fromHere ? page.contextBlock(paragraphs) : -1
    const saved = fromHere ? null : await loadReadingProgress(url, total)
    if (mine !== startGeneration) return
    if (saved) {
      // `confirm` blocks the page: opened mid-transition, it freezes the
      // pill half-resized (width animates on the main thread).
      await view.settled()
      if (mine !== startGeneration) return
    }
    const resume = !!saved && page.confirmResume()
    const startBlock = targetBlock >= 0 ? targetBlock : resume ? saved.block : 0
    if (saved && !resume) await clearReadingProgress(url)
    if (mine !== startGeneration) return
    readingUrl = url
    readingTitle = title
    readingTotal = total
    pageSource?.stop()
    pageSource = source

    let supertonicLang: SupportedLang | undefined
    if (prefs().engine === "supertonic") {
      // Same rule as the system voice: the page's declaration unless
      // the text clearly contradicts it (Gmail declares its UI language,
      // not the message's), detection alone when nothing is declared.
      const lang = resolveDocLang(payload.lang, payload.text)
      // A private window must not trigger the 398 MB first download: the
      // model may not persist there (OPFS is blocked in Firefox private
      // browsing). An already cached model is still used.
      const privateWithoutModel =
        browser.extension.inIncognitoContext &&
        !(await browser.runtime.sendMessage({ type: MODEL_CACHE_QUERY }).catch(() => false))
      if (mine !== startGeneration) return
      if (lang && !privateWithoutModel) supertonicLang = lang
      else {
        // Langue hors du modèle même après détection : un repli silencieux
        // serait déroutant — dire pourquoi la voix système est utilisée à sa
        // place.
        void browser.runtime.sendMessage({
          type: NOTIFY,
          message: browser.i18n.getMessage(
            lang ? "noticeSupertonicPrivateWindow" : "noticeSupertonicLangUnsupported"
          ),
        } satisfies NotifyMessage)
      }
    }

    const options = {
      paragraphs, text: payload.text, title, startBlock, personalRules, source, prefs,
      emit: (event: PlayerEvent) => {
        if (player === next) onPlayerEvent(next.engine, event)
      },
    }
    const next: Player = supertonicLang
      ? createSupertonicPlayer({ ...options, lang: supertonicLang, token })
      : createSystemPlayer({ ...options, lang: payload.lang })
    // Same engine: the new reading replaces the old queue by itself. A
    // stop sent to the TTS host could even overtake the new start.
    if (player?.engine !== next.engine) player?.stop()
    else player?.dispose()
    player = next

    follower.begin(paragraphs, source?.anchors)
    blockIndex = startBlock
    reading = true
    paused = false
    markTab(true)
    readingTelemetryStarted = false
    readingTelemetryFailed = false
    // Prendre la parole : les pastilles des autres onglets s'en déduisent.
    void browser.storage.local.set({ [READER_TOKEN]: token })
    // La pastille a pu être masquée : une lecture lancée depuis le menu
    // contextuel doit quand même offrir de quoi l'arrêter.
    view.attach()
    // Supertonic reports its own loading; the page's voices start at once.
    if (next.engine === "system") view.setState("playing", title)
    view.setPosition(startBlock, readingTotal)
    void persistProgress(startBlock)
    next.start()
  }

  /**
   * Compte une écoute au premier son confirmé, une seule fois par demande.
   * Les réglages, paragraphes et reprises réutilisent ces gardes ; les
   * générations des moteurs écartent leurs callbacks devenus obsolètes.
   */
  function trackReadingStarted(engine: ReaderEngine) {
    if (readingTelemetryStarted) return
    readingTelemetryStarted = true
    track({ name: "read_started", properties: { engine } })
  }

  /** Une catégorie fermée par lecture suffit à repérer les écoutes en échec. */
  function trackReadingFailed(engine: ReaderEngine, reason: ReadFailure) {
    if (readingTelemetryFailed) return
    readingTelemetryFailed = true
    track({ name: "read_failed", properties: { engine, reason } })
  }

  /** Arrivée en fin de file après un son, y compris après navigation ou erreurs. */
  function trackReadingCompleted(engine: ReaderEngine) {
    if (!readingTelemetryStarted) return
    track({ name: "read_completed", properties: { engine, had_errors: readingTelemetryFailed } })
  }

  /** ⏹ : couper le moteur, puis se replier. */
  function stop() {
    player?.stop()
    fold()
  }

  /** Revenir au repos sans toucher au moteur de synthèse. */
  function fold() {
    startGeneration++
    pageSource?.stop()
    pageSource = null
    // La file coupée ne nous appartient plus : un `end` en retard ne doit pas
    // replier une lecture relancée entre-temps.
    player?.dispose()
    player = null
    reading = false
    paused = false
    markTab(false)
    follower.end()
    view.setState("idle")
  }

  function persistProgress(block: number) {
    if (!readingUrl || readingTotal <= 0 || block < 0 || block >= readingTotal) return
    return saveReadingProgress({
      url: readingUrl,
      title: readingTitle,
      block,
      total: readingTotal,
      updatedAt: Date.now(),
    })
  }

  return {
    get reading() {
      return reading
    },
    start,
    toggle,
    stop,
    navigate,
    /** Abandons a start still on its way (the pill was dismissed meanwhile). */
    cancel() {
      startGeneration++
    },
    prefsChanged(previous: ReaderPreferences) {
      if (!reading) return
      // Neither engine can take over the other's queue: without this, Play
      // resumed the old engine and the new choice was silently ignored. The
      // saved progress lets the next start offer to pick up where it stopped.
      if (prefs().engine !== previous.engine) return stop()
      player?.update(previous)
    },
    /** Un autre onglet a pris la parole : se replier, sans toucher au moteur. */
    storageChanged(changes: Record<string, { newValue?: unknown }>) {
      if (!(READER_TOKEN in changes) || changes[READER_TOKEN]?.newValue === token) return
      fold()
    },
    /** Messages for the engine (TTS host events, live block requests). */
    receive(message: { type?: string } | undefined) {
      if (!message) return
      const reply = reading ? player?.receive?.(message) : undefined
      // A block request always gets an answer, if only "nothing to read".
      return reply ?? (message.type === TTS_PREPARE_BLOCK ? Promise.resolve(null) : undefined)
    },
    // La synthèse survit au déchargement de la page : sans ça la lecture
    // continue après un rechargement, hors de portée de la nouvelle pastille.
    // Pour Supertonic, `tabs.onRemoved` ne couvre que la fermeture de
    // l'onglet — un rechargement le laisse ouvert, donc sans ce signal
    // l'audio continuerait indéfiniment, sans plus aucune pastille pour
    // l'arrêter : le même risque que l'onglet fermé, côté rechargement.
    pageHidden() {
      startGeneration++
      pageSource?.stop()
      if (!reading) return
      player?.stop()
      // The page can come back from bfcache with this same document.title frozen:
      // without this, navigating back would resurrect the mark on a page
      // that isn't reading anymore.
      markTab(false)
    },
    /** Extension reloaded or updated: nothing can reach the extension anymore. */
    invalidate() {
      startGeneration++
      pageSource?.stop()
      // No message can leave an invalidated context: only the page's own
      // speech can still be silenced.
      player?.dispose()
      cancelSpeech()
      follower.end()
      // `fold()` isn't called, so the title would stay marked without this.
      markTab(false)
    },
  }
}

/** Même découpe que `splitBlocks` côté hôte : un bloc par paragraphe. */
const splitParagraphs = (text: string) =>
  text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)

/**
 * Traduit la cause émise par tts-host.ts en clé i18n — voir tts-messages.ts.
 *
 * `MessageKey`, pas `string` : TypeScript prend la dernière surcharge de
 * `getMessage`, celle qui liste toutes les clés de
 * public/_locales/<locale>/messages.json — un `Record<..., string>` trop large
 * romprait l'appel plus haut.
 */
type MessageKey = Parameters<typeof browser.i18n.getMessage>[0]
const LOADING_REASON_KEY: Record<TtsLoadingReason, MessageKey> = {
  "downloading-model": "ttsDownloadingModel",
  "loading-engine": "ttsLoadingEngine",
  "loading-voice": "ttsLoadingVoice",
  "preparing-next": "ttsPreparingNext",
}
