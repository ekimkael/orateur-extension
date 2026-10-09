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
  type PillPosition,
} from "../lib/reader-prefs"
import { expandText } from "../lib/pronunciation/index.ts"
import { createAnchorFinder, findBlockIndex } from "../lib/read-anchor.ts"
import { buildReadingIntro } from "../lib/reading-intro"
import { toSupertonicLang, type SupportedLang } from "../lib/supertonic-lang.ts"
import { detectLang } from "../lib/detect-lang.ts"
import { markTab } from "../lib/tab-title.ts"
import {
  MODEL_CACHE_QUERY,
  TTS_CONTROL,
  TTS_EVENT,
  TTS_SEEK,
  TTS_SET_SPEED,
  TTS_SPEAK,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsLoadingReason,
  type TtsSeekMessage,
  type TtsSetSpeedMessage,
  type TtsSpeakMessage,
} from "../lib/tts-messages"
// Type uniquement — importer la valeur (la liste des 10 voix, ses libellés)
// depuis lib/supertonic/* ferait entrer le moteur dans ce bundle. La petite
// liste ci-dessous, plus bas dans ce fichier, est donc dupliquée à dessein.
import type { SupertonicVoice } from "../lib/supertonic/types.ts"
import { track } from "../lib/telemetry.ts"
import { isHidden, loadHiddenSites, addHiddenSite, onHiddenSitesChanged } from "../lib/site-rules.ts"
import { charteTokens } from "../lib/charte.ts"
import { applyTheme } from "../lib/theme.ts"
import { loadUiPrefs, onUiPrefsChanged, type ColorTheme } from "../lib/ui-prefs.ts"
import { moveReadingBlock } from "../lib/reading-navigation.ts"
import {
  clearReadingProgress,
  loadReadingProgress,
  saveReadingProgress,
} from "../lib/reading-progress.ts"

export interface ReadPagePayload {
  text: string
  title?: string
  lang?: string
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

type PillState = "idle" | "loading" | "playing" | "paused" | "error"

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
    /**
     * La lecture en cours utilise Supertonic plutôt que le moteur système.
     *
     * `blocks`/`blockIndex`/`charIndex`/`generation`/`stale` ne servent qu'au
     * chemin système : l'hôte Supertonic garde sa propre position, jamais
     * exposée ici — juste des événements `TTS_EVENT` à répercuter sur la
     * pastille.
     */
    let usingSupertonic = false
    /** Réinjecté à chaque `playing` : un état de chargement y écrit la
     *  progression du téléchargement par-dessus, il faut de quoi le restaurer. */
    let supertonicTitle = ""
    let readingUrl = ""
    let readingTitle = ""
    let readingTotal = 0
    /**
     * Vrai dès qu'un `reason: "downloading-model"` est vu pendant la session
     * Supertonic en cours — sert à ne compter `supertonic_download_completed`/
     * `_failed` (télémétrie, jalon 1c) que quand un téléchargement a vraiment
     * eu lieu, pas à chaque lecture qui trouve le modèle déjà en cache.
     */
    let sawSupertonicDownload = false
    const token = Math.random().toString(36).slice(2)
    // Réassigné, pas figé : une lecture doit partir sur les réglages du moment,
    // y compris ceux changés depuis un autre onglet.
    let prefs = await loadPrefs()
    const hiddenSites = await loadHiddenSites()
    const uiPrefs = await loadUiPrefs()
    let contextTarget: Element | null = null

    const pill = createPill(onPrimary, onSecondary, () => navigate(-1), () => navigate(1), prefs, !isHidden(location.hostname, hiddenSites), uiPrefs.theme)
    const follower = createFollower()
    follower.setEnabled(prefs.follow)

    browser.runtime.onMessage.addListener(onMessage)
    browser.runtime.onMessage.addListener(onTtsEvent)
    browser.storage.onChanged.addListener(onTokenChanged)
    document.addEventListener("contextmenu", rememberContextTarget, true)
    const unsubscribeHiddenSites = onHiddenSitesChanged((sites) => {
      if (isHidden(location.hostname, sites)) pill.detach()
      else pill.attach()
    })
    const unsubscribeUiPrefs = onUiPrefsChanged((next) => pill.setTheme(next.theme))
    const unsubscribePrefs = onPrefsChanged((newPrefs) => {
      const speedChanged = newPrefs.speed !== prefs.speed
      const voiceChanged = newPrefs.voiceURI !== prefs.voiceURI
      prefs = newPrefs
      pill.updatePrefs(newPrefs)
      follower.setEnabled(newPrefs.follow)
      if (!reading) return

      if (usingSupertonic) {
        // La vitesse s'applique tout de suite (audio.playbackRate, jamais de
        // resynthèse) : aucune raison d'attendre la reprise, contrairement au
        // chemin système.
        //
        // ponytail: un changement de voix Supertonic en cours de lecture
        // n'est pas repris à la volée — l'hôte ne garde pas de position dans
        // le texte pour relancer avec une autre voix. Arrêter puis relire
        // pour l'entendre.
        if (speedChanged) {
          void browser.runtime.sendMessage({
            type: TTS_SET_SPEED,
            speed: newPrefs.speed,
          } satisfies TtsSetSpeedMessage)
        }
        return
      }

      if (!speedChanged && !voiceChanged) return
      // La synthèse ne réaccorde pas un utterance déjà lancé : le seul moyen
      // d'entendre la nouvelle vitesse est de refaire la file à partir du mot
      // en cours. En pause, on attend la reprise plutôt que de repartir tout
      // seul — `cancel()` déferait la pause.
      if (paused) stale = true
      else speak()
    })
    // La synthèse survit au déchargement de la page : sans ça la lecture
    // continue après un rechargement, hors de portée de la nouvelle pastille.
    // Pour Supertonic, `tabs.onRemoved` ne couvre que la fermeture de
    // l'onglet — un rechargement le laisse ouvert, donc sans ce signal
    // l'audio continuerait indéfiniment, sans plus aucune pastille pour
    // l'arrêter : le même risque que l'onglet fermé, côté rechargement.
    ctx.addEventListener(window, "pagehide", () => {
      if (!reading) return
      if (usingSupertonic) {
        void browser.runtime.sendMessage({ type: TTS_CONTROL, action: "stop" } satisfies TtsControlMessage)
      } else {
        cancelSpeech()
      }
      // The page can come back from bfcache with this same document.title frozen:
      // without this, navigating back would resurrect the mark on a page
      // that isn't reading anymore.
      markTab(false)
    })
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.runtime.onMessage.removeListener(onTtsEvent)
      browser.storage.onChanged.removeListener(onTokenChanged)
      document.removeEventListener("contextmenu", rememberContextTarget, true)
      unsubscribePrefs()
      unsubscribeHiddenSites()
      unsubscribeUiPrefs()
      cancelSpeech()
      follower.end()
      pill.remove()
      // Extension reload or update while reading: `fold()` isn't called,
      // so the title would stay marked without this.
      markTab(false)
    })

    function onMessage(message: Partial<StartReadingMessage>) {
      if (message?.type !== START_READING || !message.text) return
      start(message as ReadPagePayload, message.fromHere)
    }

    function rememberContextTarget(event: Event) {
      contextTarget = event.target instanceof Element ? event.target : null
    }

    /** Événements de l'hôte Supertonic : pilotent directement la pastille. */
    function onTtsEvent(message: Partial<TtsEventMessage>) {
      if (message?.type !== TTS_EVENT || !message.state || !reading || !usingSupertonic) return
      const state = message.state
      if (state.phase === "loading") {
        // Keep preparation and download feedback inside the compact pill.
        const label = state.reason ? browser.i18n.getMessage(LOADING_REASON_KEY[state.reason]) : undefined
        // Télémétrie (jalon 1c) : une seule fois par session, au tout premier
        // "downloading-model" — les ticks de progression suivants repassent
        // par cette même branche sans redéclencher l'événement.
        if (state.reason === "downloading-model" && !sawSupertonicDownload) {
          sawSupertonicDownload = true
          track({ name: "supertonic_download_started" })
        }
        pill.setState(
          "loading",
          supertonicTitle,
          true,
          label ? { label, percent: state.progress, reason: state.reason } : undefined
        )
      } else if (state.phase === "playing") {
        if (sawSupertonicDownload) {
          sawSupertonicDownload = false
          track({ name: "supertonic_download_completed" })
        }
        paused = false
        blockIndex = state.block
        void persistProgress(state.block)
        follower.show(state.block)
        pill.setPosition(state.block, state.total)
        pill.setState("playing", supertonicTitle)
      } else if (state.phase === "paused") {
        paused = true
        pill.setState("paused")
      } else if (state.phase === "ended") {
        track({ name: "read_completed" })
        void clearReadingProgress(readingUrl)
        fold()
      } else if (state.phase === "error") {
        if (sawSupertonicDownload) {
          sawSupertonicDownload = false
          track({ name: "supertonic_download_failed", properties: { reason: classifyTtsError(state.message) } })
        }
        void browser.runtime.sendMessage({
          type: NOTIFY,
          // `state.message` d'une exception (ONNX, réseau) n'a rien de
          // traduisible ; seule l'erreur audio statique de tts-host.ts l'est.
          message:
            state.reason === "audio-playback"
              ? browser.i18n.getMessage("ttsAudioError")
              : state.message,
        } satisfies NotifyMessage)
        fold()
        pill.setState("error", readingTitle)
      }
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
        if (usingSupertonic) {
          // Retour immédiat, comme le chemin système : le TTS_EVENT qui suit
          // ne fait que confirmer le même état, sans le faire attendre.
          pill.setState(paused ? "paused" : "playing")
          void browser.runtime.sendMessage({
            type: TTS_CONTROL,
            action: paused ? "pause" : "resume",
          } satisfies TtsControlMessage)
          return
        }
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
      if (!started && !reading) pill.setState("error", document.title)
    }

    /** ⏹ pendant la lecture, ✕ au repos : ne plus afficher Orateur sur ce domaine. */
    function onSecondary() {
      if (reading) return stop()
      pill.detach()
      void addHiddenSite(location.hostname)
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
      charIndex = 0
      follower.show(block)
      pill.setPosition(block, readingTotal)
      void persistProgress(block)

      if (usingSupertonic) {
        void browser.runtime.sendMessage({
          type: TTS_SEEK,
          block,
          paused,
        } satisfies TtsSeekMessage)
        return
      }

      if (paused) {
        generation++
        cancelSpeech()
        stale = true
      }
      else speak()
    }

    /** Choisit le moteur, puis démarre — le reste ne se recroise plus. */
    async function start(payload: ReadPagePayload, fromHere = false) {
      const paragraphs = splitParagraphs(payload.text)
      const total = paragraphs.length
      if (!total) return fold()
      const url = canonicalUrl()
      const title = payload.title ?? ""
      const targetBlock = fromHere ? findBlockIndex(document, paragraphs, contextTarget) : -1
      const saved = fromHere ? null : await loadReadingProgress(url, total)
      const resume = !!saved && confirm(browser.i18n.getMessage("readerResumePrompt"))
      const startBlock = targetBlock >= 0 ? targetBlock : resume ? saved.block : 0
      if (saved && !resume) await clearReadingProgress(url)
      readingUrl = url
      readingTitle = title
      readingTotal = total

      if (prefs.engine === "supertonic") {
        // La déclaration de la page d'abord ; si elle manque ou sort du
        // modèle, une détection sur le texte réel avant d'abandonner —
        // beaucoup de pages ne déclarent aucun `lang`.
        const supertonicLang =
          toSupertonicLang(payload.lang ?? "") ?? detectLang(payload.text, null)
        if (supertonicLang) {
          startSupertonic(payload, supertonicLang, startBlock)
          return
        }
        // Langue hors du modèle même après détection : un repli silencieux
        // serait déroutant — dire pourquoi la voix système est utilisée à sa
        // place.
        void browser.runtime.sendMessage({
          type: NOTIFY,
          message: browser.i18n.getMessage("noticeSupertonicLangUnsupported"),
        } satisfies NotifyMessage)
      }
      startSystem(payload, startBlock)
    }

    function startSupertonic(payload: ReadPagePayload, lang: SupportedLang, startBlock: number) {
      // `lang` est la langue résolue (déclaration ou détection), pas
      // forcément `payload.lang` : l'annonce du titre doit sonner dans la
      // langue qui va réellement être lue.
      //
      // Même annonce de titre qu'en système (buildReadingIntro), composée ici
      // plutôt que par l'hôte : lib/tts-host.ts ne connaît ni onglets ni titres,
      // seulement du texte à synthétiser.
      const intro = buildReadingIntro(lang, payload.title ?? "")
      const text = intro ? `${intro} ${payload.text}` : payload.text

      // Sur `payload.text`, pas sur `text` : l'annonce du titre n'est écrite
      // nulle part dans la page. L'hôte la recolle au premier paragraphe
      // (`splitBlocks`), donc les index concordent quand même.
      follower.begin(splitParagraphs(payload.text))

      usingSupertonic = true
      blockIndex = startBlock
      reading = true
      paused = false
      markTab(true)
      sawSupertonicDownload = false
      supertonicTitle = payload.title ?? ""
      track({ name: "read_started", properties: { engine: "supertonic" } })
      void browser.storage.local.set({ [READER_TOKEN]: token })
      pill.attach()
      pill.setState("loading", supertonicTitle, true)
      pill.setPosition(startBlock, readingTotal)
      void persistProgress(startBlock)
      void browser.runtime.sendMessage({
        type: TTS_SPEAK,
        text,
        title: payload.title,
        lang,
        voice: prefs.supertonicVoice,
        speed: prefs.speed,
        startBlock,
        token,
      } satisfies Partial<TtsSpeakMessage>)
    }

    function startSystem(payload: ReadPagePayload, startBlock: number) {
      // Un bloc par paragraphe, pour éviter la limite de longueur de Chrome.
      // Le découpage passe avant `expandText`, qui écrase les blancs — les
      // frontières de paragraphes n'y survivraient pas.
      const raw = splitParagraphs(payload.text)

      // Texte des blocs tel qu'il est dans la page : ni l'annonce du titre ni
      // `expandText` ne s'y appliquent — c'est sur lui que le suivi retrouve
      // le paragraphe dans le DOM. Il reste aligné sur `blocks` : aucune règle
      // de `expandText` ne remplace par du vide, donc son `filter(Boolean)`
      // plus bas ne retire jamais rien.
      follower.begin([...raw])

      // La déclaration de la page l'emporte quand la détection ne la
      // contredit pas — elle porte souvent une région (`en-US`) que la
      // détection, elle, ne rend jamais. Ne s'en écarter que si le texte
      // réel dit clairement autre chose : article entier mal étiqueté, ou
      // page sans `lang` du tout.
      const declared = toSupertonicLang(payload.lang ?? "")
      const detected = detectLang(payload.text, declared)
      const resolvedLang = detected && detected !== declared ? detected : payload.lang

      // Le titre n'est pas dans le texte extrait — Readability retire le h1 qui
      // le répète. L'annoncer en tête du premier bloc plutôt qu'en bloc à part :
      // il suit alors la même reprise que le reste, comme sur mobile.
      const intro = buildReadingIntro(resolvedLang ?? "", payload.title ?? "")
      if (intro && raw.length) raw[0] = `${intro} ${raw[0]}`

      // Texte à dire, jamais à afficher : sigles épelés, symboles verbalisés,
      // anglicismes réécrits pour les voix système. Ce sont les seules
      // disponibles ici, donc la couche phonétique s'applique toujours.
      blocks = raw.map((block) => expandText(block, { language: resolvedLang })).filter(Boolean)
      if (!blocks.length) return fold()

      blockIndex = startBlock
      charIndex = 0
      lang = resolvedLang
      reading = true
      paused = false
      stale = false
      markTab(true)
      track({ name: "read_started", properties: { engine: "system" } })
      // Prendre la parole : les pastilles des autres onglets s'en déduisent.
      void browser.storage.local.set({ [READER_TOKEN]: token })
      // La pastille a pu être masquée : une lecture lancée depuis le menu
      // contextuel doit quand même offrir de quoi l'arrêter.
      pill.attach()
      pill.setState("playing", payload.title ?? "")
      pill.setPosition(startBlock, readingTotal)
      void persistProgress(startBlock)
      speak()
    }

    /**
     * Relance la lecture à partir de `blockIndex`/`charIndex`, aux réglages
     * du moment. Appelée au démarrage comme à chaque changement de vitesse
     * ou de voix : dans les deux cas on repart du mot où la voix en était.
     *
     * Un seul énoncé en vol à la fois (`play`), jamais toute la file
     * poussée d'un coup dans `speechSynthesis.speak()` : sur Chrome/Windows,
     * plusieurs énoncés mis en file en même temps se chevauchent ou
     * s'interrompent au hasard — bug connu de la file native. Enchaîner au
     * `end` du précédent est le contournement standard, et il gagne au
     * passage la robustesse qui manquait avant : `error` avance aussi à la
     * suite plutôt que de laisser la pastille dépliée sans plus jamais rien
     * dire.
     */
    function speak() {
      generation++
      cancelSpeech()
      play(blockIndex, charIndex)
    }

    function play(block: number, from: number) {
      const text = blocks[block]
      if (text === undefined) {
        track({ name: "read_completed" })
        void clearReadingProgress(readingUrl)
        fold()
        return
      }
      const mine = generation

      // Résolue à chaque énoncé : `getVoices()` reconstruit sa liste à
      // chaque appel. Introuvable (voix désinstallée, autre machine) vaut
      // défaut.
      const voice = prefs.voiceURI
        ? speechSynthesis.getVoices().find((v) => v.voiceURI === prefs.voiceURI)
        : undefined
      const utterance = new SpeechSynthesisUtterance(text.slice(from))
      if (lang) utterance.lang = lang
      utterance.rate = prefs.speed
      if (voice) utterance.voice = voice

      utterance.addEventListener("start", () => {
        if (mine !== generation) return
        blockIndex = block
        charIndex = from
        void persistProgress(block)
        follower.show(block)
      })
      // `charIndex` est compté depuis le début de l'énoncé, donc depuis le
      // reste du bloc : le rebaser sur le bloc entier, sinon une deuxième
      // reprise repartirait trop tôt.
      //
      // ponytail: les voix distantes n'émettent pas toujours `boundary`. Sans
      // lui la position reste au dernier départ, et changer la vitesse fait
      // reprendre le bloc courant depuis là — jamais plus loin que ça.
      utterance.addEventListener("boundary", (event) => {
        if (mine !== generation) return
        charIndex = from + event.charIndex
      })
      utterance.addEventListener("end", () => {
        if (mine !== generation) return
        play(block + 1, 0)
      })
      // Un énoncé qui échoue à se synthétiser ne doit pas taire tout le
      // reste de l'article : avancer quand même, comme une fin naturelle.
      utterance.addEventListener("error", () => {
        if (mine !== generation) return
        play(block + 1, 0)
      })
      speechSynthesis.speak(utterance)
    }

    /** ⏹ : couper le moteur, puis se replier. */
    function stop() {
      if (usingSupertonic) {
        void browser.runtime.sendMessage({
          type: TTS_CONTROL,
          action: "stop",
        } satisfies TtsControlMessage)
      } else {
        cancelSpeech()
      }
      fold()
    }

    /** Revenir au repos sans toucher au moteur de synthèse. */
    function fold() {
      reading = false
      paused = false
      stale = false
      usingSupertonic = false
      markTab(false)
      follower.end()
      // La file coupée ne nous appartient plus : un `end` en retard ne doit pas
      // replier une lecture relancée entre-temps.
      generation++
      pill.setState("idle")
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
  },
})

function canonicalUrl() {
  const href = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href
  const url = new URL(href, location.href)
  url.hash = ""
  return url.href
}

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

const PILL_CSS = charteTokens(".pill-row") + `
* { box-sizing: border-box }
[hidden] { display: none !important }
.pill-row {
  accent-color: var(--primary);
  --pop-slide: translateY(4px);
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 48px);
  padding: 6px;
  border-radius: 999px;
  font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  color: var(--foreground);
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  position: relative;
}
.pill-row[data-active] { width: min(336px, calc(100vw - 48px)) }
:host([data-expanded]) .pill-row {
  padding: 12px;
  border-radius: 20px;
}
.pill-content { padding: 2px 4px 12px; min-width: 0 }
.pill-row[data-settings-open]:not([data-loading]) .pill-content {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
}
.pill-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.pill-status-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 4px }
.pill-status { flex: 1; min-width: 0; color: var(--muted-foreground); overflow-wrap: anywhere }
.pill-percent { font-variant-numeric: tabular-nums; color: var(--muted-foreground) }
.pill-controls { display: flex; align-items: center; gap: 4px }
.pill-transport { display: flex; align-items: center; gap: 4px }
.pill-meta { flex: 1; text-align: center; font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums }
.pill-spacer { flex: 1 }
.pill-row[data-loading] {
  flex-direction: row;
  align-items: center;
  gap: 4px;
}
.pill-row[data-loading] .pill-controls { display: contents }
.pill-row[data-loading] .pill-transport { order: 1 }
.pill-row[data-loading] .pill-content {
  order: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  padding: 0 4px;
}
.pill-row[data-loading] .pill-settings { order: 3 }
.pill-row[data-loading] .pill-secondary { order: 4 }
.pill-row[data-loading] .pill-status-row { flex: 1; min-width: 0; margin: 0 }
.pill-row[data-loading] .pill-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pill-row[data-loading] .pill-primary:disabled { opacity: 1; cursor: wait }
.pill-row[data-loading] .pill-progress { flex: 1; height: 6px; margin: 0 }
.pill-row[data-downloading] .pill-status-row {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}
button:hover:not(:disabled), .pill-settings[aria-expanded="true"] { background: color-mix(in srgb, var(--foreground) 8%, transparent) }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
button:disabled { opacity: 0.55; cursor: default }
@media (prefers-reduced-motion: no-preference) {
  button { transition: transform 160ms var(--ease-out) }
  button:active:not(:disabled):not(:focus-visible) { transform: scale(0.97); transition-duration: 100ms }
}
/*
 * Bouton principal (▶/⏸) : seul rempli de la pastille, à la couleur de marque
 * — c'est lui qui lance ou suspend la lecture, les deux autres ne font
 * qu'accompagner ou interrompre.
 */
.pill-primary { width: 40px; height: 40px; background: var(--primary); color: var(--primary-foreground) }
.pill-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 88%, black) }
.pill-primary:focus-visible { outline-color: var(--foreground) }
/*
 * Icône en masque plutôt qu'en emoji : le rendu diffère en couleur et en
 * chasse selon l'OS. Le masque suit currentColor, donc l'état désactivé et le
 * focus restent cohérents avec les autres boutons, et rien n'entre dans le
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
button[data-icon="settings"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E");
}
button[data-icon="cloud-download"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 13v8l-4-4m4 4 4-4M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284'/%3E%3C/svg%3E");
}
button[data-icon="play"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'/%3E%3C/svg%3E");
}
button[data-icon="pause"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='14' y='3' width='5' height='18' rx='1'/%3E%3Crect x='5' y='3' width='5' height='18' rx='1'/%3E%3C/svg%3E");
}
button[data-icon="square"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3C/svg%3E");
}
button[data-icon="x"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 6 6 18'/%3E%3Cpath d='m6 6 12 12'/%3E%3C/svg%3E");
}
button[data-icon="previous"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
}
button[data-icon="next"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
}
/* Rotate the loading icon only; the button itself remains stationary. */
button[data-icon="loader-circle"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12a9 9 0 1 1-6.219-8.56'/%3E%3C/svg%3E");
}
@media (prefers-reduced-motion: no-preference) {
  button[data-icon="loader-circle"]::before { animation: loading-spin 700ms linear infinite }
}
.settings-popover {
  position: absolute;
  bottom: 100%;
  right: -1px;
  /* Même fond que la pastille : le popover en est le prolongement, pas une
     surface étrangère posée dessus. Le liseré fait l'arête. */
  background: var(--card);
  border-radius: 16px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: 16px;
  width: min(336px, calc(100vw - 48px));
  max-height: calc(100dvh - 200px);
  overflow-y: auto;
  overscroll-behavior: contain;
  color: var(--foreground);
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transform: var(--pop-slide);
  transition:
    opacity 150ms var(--ease-out),
    transform 150ms var(--ease-out);
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
  transform: translateY(0);
}
.settings-popover[data-instant] { transition: none }
/* Keep settings inside the viewport at all six dock positions. */
:host([data-orateur-position$="left"]) .settings-popover { right: auto; left: -1px }
:host([data-orateur-position^="top"]) .pill-row {
  --pop-slide: translateY(-4px);
}
:host([data-orateur-position^="top"]) .settings-popover {
  bottom: auto;
  top: 100%;
  margin-bottom: 0;
  margin-top: 8px;
}
:host([data-orateur-position$="center"]) .settings-popover {
  right: auto;
  left: 50%;
  translate: -50% 0;
}
@media (prefers-reduced-motion: no-preference) {
  .pill-progress-fill { transition: transform 150ms linear }
}
@keyframes loading-spin { to { transform: rotate(360deg) } }
.pill-progress {
  height: 3px;
  margin-top: 10px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}
.pill-progress-fill {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: left;
  background: var(--primary);
}
/*
 * Une case à cocher se lit en ligne, intitulé à droite — pas dans la colonne
 * de .settings-row, où le contrôle prend toute la largeur.
 */
.settings-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  cursor: pointer;
}
.settings-toggle input { flex: none; margin: 0; cursor: pointer }
.settings-toggle input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
.settings-row { display: flex; flex-direction: column; gap: 6px }
.settings-row + .settings-row { margin-top: 12px }
.settings-note + .settings-row { margin-top: 12px }
.settings-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
  font-weight: 600;
  cursor: pointer;
}
/* La valeur vit dans l'intitulé, à droite : elle appartient au réglage, pas à
   une ligne de plus. Chasse fixe pour que 1,0× et 1,2× ne la fassent pas
   sauter d'un pixel à chaque cran. */
.settings-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}
.settings-control {
  width: 100%;
  font: inherit;
  font-size: 13px;
  min-height: 36px;
  color: var(--foreground);
  cursor: pointer;
}
select.settings-control {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--background);
  /* Un select natif tronque tout seul ; sans ça un nom de voix à rallonge
     élargit le popover jusqu'à le sortir de l'écran. */
  max-width: 100%;
}
select.settings-control:hover { background: color-mix(in srgb, var(--foreground) 6%, var(--background)) }
input.settings-control { margin: 2px 0 }
.settings-control:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
/* Le coût du premier ▶ Supertonic, collé à la ligne Moteur — c'est ce qui le
   rend acceptable plutôt que subi. Masqué par défaut : afficher un [hidden]
   coûte moins qu'un état de plus dans syncControls(). */
.settings-note {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted-foreground);
}
.settings-note strong { color: var(--foreground); font-weight: 600 }
`

/** Libellé et intitulé accessible de chaque bouton, état par état. */
const LABELS: Record<PillState, { primary: string; secondary: string }> = {
  idle: { primary: "play", secondary: "x" },
  loading: { primary: "loader-circle", secondary: "x" },
  playing: { primary: "pause", secondary: "square" },
  paused: { primary: "play", secondary: "square" },
  error: { primary: "play", secondary: "x" },
}

/**
 * Traduit la cause émise par tts-host.ts en clé i18n — voir tts-messages.ts.
 *
 * `MessageKey`, pas `string` : TypeScript prend la dernière surcharge de
 * `getMessage`, celle qui liste toutes les clés de
 * public/_locales/<locale>/messages.json — un `Record<..., string>` trop large
 * romprait l'appel plus bas.
 */
type MessageKey = Parameters<typeof browser.i18n.getMessage>[0]
const LOADING_REASON_KEY: Record<TtsLoadingReason, MessageKey> = {
  "downloading-model": "ttsDownloadingModel",
  "loading-engine": "ttsLoadingEngine",
  "loading-voice": "ttsLoadingVoice",
  "preparing-next": "ttsPreparingNext",
}

/**
 * Classe grossièrement une erreur de téléchargement pour la télémétrie
 * (jalon 1c) — jamais le texte brut de `state.message` : il peut contenir un
 * chemin, un nom de fichier, une trace, rien de destiné à quitter la machine.
 */
function classifyTtsError(message: string): "http" | "network" | "unknown" {
  if (/HTTP \d/.test(message)) return "http"
  if (/fetch|network/i.test(message)) return "network"
  return "unknown"
}

/** Même découpe que `splitBlocks` côté hôte : un bloc par paragraphe. */
const splitParagraphs = (text: string) =>
  text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)

/** Nom du surlignage dans le registre du document. */
const HIGHLIGHT_NAME = "orateur-reading"

/**
 * Fond translucide, et rien d'autre : la couleur du texte reste celle de la
 * page, donc son contraste aussi, et la même teinte tient sur fond clair comme
 * sur fond sombre. Vit dans le document de la page, hors de portée des tokens
 * du shadow root — donc en dur, mais alignée sur --primary de la charte
 * (même formule que ::selection, entrypoints/options/style.css).
 */
const HIGHLIGHT_CSS = `::highlight(${HIGHLIGHT_NAME}){background-color:rgb(245 78 0 / 0.3)}`

/**
 * Silence du défilement automatique après un geste de l'utilisateur : le
 * temps de deux ou trois paragraphes, de quoi relire un passage sans que la
 * page reparte toute seule.
 */
const MANUAL_SCROLL_GRACE = 10_000

/**
 * Gestes qui valent reprise en main du défilement.
 *
 * Jamais `scroll` : l'événement ne dit pas qui a scrollé, nos propres
 * `scrollIntoView` se prendraient donc eux-mêmes pour un geste de
 * l'utilisateur et le suivi s'arrêterait au premier paragraphe.
 */
const SCROLL_GESTURES = ["wheel", "touchmove", "keydown"] as const

/**
 * Suit la lecture sur la page : surligne le paragraphe lu, et l'amène dans le
 * champ de vision quand il n'y est pas.
 *
 * L'API CSS Custom Highlight plutôt que des `<span>` posés autour du texte :
 * elle ne peut peindre que le fond, la couleur et la décoration — donc aucun
 * recalcul de mise en page, aucune mutation du DOM de la page (rien à faire
 * passer par Trusted Types, rien qu'un rendu React du site puisse effacer,
 * aucun sélecteur CSS de la page cassé), et une seule repeinte par
 * paragraphe.
 */
function createFollower() {
  // Chrome 105, Safari 17.2, Firefox 140. Ailleurs on lit sans suivre, plutôt
  // que d'embarquer un polyfill qui, lui, mutera la page.
  const supported = typeof Highlight === "function" && typeof CSS !== "undefined" && "highlights" in CSS

  let sheet: CSSStyleSheet | null = null
  let highlight: Highlight | null = null
  let findAnchor: ReturnType<typeof createAnchorFinder> | null = null
  let blocks: string[] = []
  /** Dernier paragraphe surligné : évite de rechercher deux fois le même. */
  let current = -1
  let anchor: Element | null = null
  let enabled = true
  let lastGesture = 0

  const noteGesture = () => {
    lastGesture = Date.now()
  }

  /** Ouvre le suivi sur les blocs d'une lecture. Idempotent. */
  function begin(paragraphs: string[]) {
    if (!supported) return
    end()
    blocks = paragraphs
    findAnchor = createAnchorFinder(document)
    if (!sheet) {
      // Feuille construite plutôt qu'un `<style>` injecté : rien à soumettre à
      // la directive `style-src` de la page, et rien à retirer de son DOM.
      sheet = new CSSStyleSheet()
      sheet.replaceSync(HIGHLIGHT_CSS)
    }
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    highlight = new Highlight()
    CSS.highlights.set(HIGHLIGHT_NAME, highlight)
    for (const gesture of SCROLL_GESTURES) {
      window.addEventListener(gesture, noteGesture, { passive: true })
    }
  }

  /** Surligne le paragraphe `index`, et l'amène à l'écran s'il n'y est pas. */
  function show(index: number) {
    if (!findAnchor || index === current) return
    current = index
    const block = blocks[index]
    // Bloc introuvable dans la page — un `<pre>`, dit « Extrait de code. » —
    // le paragraphe précédent reste surligné plutôt que rien : la lecture est
    // bien là, quelque part entre les deux.
    anchor = block === undefined ? null : findAnchor(block)
    if (anchor && enabled) paint(anchor)
  }

  function paint(element: Element) {
    if (!highlight) return
    const range = document.createRange()
    range.selectNodeContents(element)
    highlight.clear()
    highlight.add(range)
    reveal(element)
  }

  function reveal(element: Element) {
    if (Date.now() - lastGesture < MANUAL_SCROLL_GRACE) return
    const box = element.getBoundingClientRect()
    // Déjà en vue : le haut du bloc est à l'écran, dans les deux premiers
    // tiers. Le haut plutôt que le bloc entier — un paragraphe plus haut que
    // la fenêtre ne rentre jamais, et la page défilerait à chaque fois.
    if (box.top >= 0 && box.top <= window.innerHeight * 0.66) return
    element.scrollIntoView({
      // `center` et pas `start` : un en-tête collant masque le haut de la
      // fenêtre sur la moitié des sites.
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    })
  }

  /** Le réglage a changé pendant la lecture. */
  function setEnabled(value: boolean) {
    if (value === enabled) return
    enabled = value
    if (!enabled) highlight?.clear()
    else if (anchor) paint(anchor)
  }

  /** Rend la page à elle-même : plus de surlignage, plus d'écouteur. */
  function end() {
    blocks = []
    findAnchor = null
    anchor = null
    current = -1
    if (highlight) {
      highlight.clear()
      CSS.highlights.delete(HIGHLIGHT_NAME)
      highlight = null
    }
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)
    }
    for (const gesture of SCROLL_GESTURES) window.removeEventListener(gesture, noteGesture)
  }

  return { begin, show, setEnabled, end }
}

/**
 * Pastille flottante, dans un shadow root fermé — même isolation que la bulle
 * de sélection, pour les mêmes raisons.
 */
function createPill(
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
    ["system", browser.i18n.getMessage("engineSystem")],
    // "Voix naturelles IA" côté interface (jalon 1d) — même libellé que la
    // page d'options, "Supertonic" reste le nom du modèle, pas du moteur.
    ["supertonic", browser.i18n.getMessage("engineNaturalAI")],
  ]
  /**
   * Les 10 voix Supertonic, dupliquées depuis lib/supertonic/types.ts plutôt
   * qu'importées : la valeur (pas juste son type) ferait entrer le moteur dans
   * ce bundle chargé sur toutes les pages. Les clés i18n, elles, sont les mêmes
   * que dans lib/supertonic/types.ts (`voiceFemale1`…) — même traduction des
   * deux côtés sans rien importer.
   */
  const SUPERTONIC_VOICE_OPTIONS: Array<[SupertonicVoice, string]> = [
    ["F1", browser.i18n.getMessage("voiceFemale1")],
    ["F2", browser.i18n.getMessage("voiceFemale2")],
    ["F3", browser.i18n.getMessage("voiceFemale3")],
    ["F4", browser.i18n.getMessage("voiceFemale4")],
    ["F5", browser.i18n.getMessage("voiceFemale5")],
    ["M1", browser.i18n.getMessage("voiceMale1")],
    ["M2", browser.i18n.getMessage("voiceMale2")],
    ["M3", browser.i18n.getMessage("voiceMale3")],
    ["M4", browser.i18n.getMessage("voiceMale4")],
    ["M5", browser.i18n.getMessage("voiceMale5")],
  ]

  const host = document.createElement("orateur-reader-pill")
  host.lang = browser.i18n.getUILanguage()
  applyPosition(initialPrefs.position, host)
  applyTheme(initialTheme, host)

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = PILL_CSS
  root.append(style)

  const row = document.createElement("div")
  row.className = "pill-row"
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
  const secondary = button(onSecondary)
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

  let currentPrefs = initialPrefs
  let isPopoverOpen = false
  let currentState: PillState = "idle"
  let currentBlock = 0
  let totalBlocks = 0
  let navigationActive = false

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
  let modelCached: boolean | undefined
  let modelCacheRequest = 0
  const supertonicNote = document.createElement("div")
  supertonicNote.className = "settings-note"
  const noteLead = document.createElement("strong")
  const noteRest = document.createElement("div")
  supertonicNote.append(noteLead, noteRest)
  popover.append(supertonicNote)

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
    if (currentPrefs.engine === "supertonic") {
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

  renderVoices()
  // Chrome charge ses voix après coup : sans cet événement la liste reste
  // réduite à « Par défaut » pendant les premières secondes de la page.
  speechSynthesis.addEventListener("voiceschanged", renderVoices)

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
    if (isPopoverOpen) fitPopover()
  }
  window.addEventListener("resize", onWindowResize)
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
    if (currentPrefs.engine === "supertonic") {
      voice.value = currentPrefs.supertonicVoice
    } else {
      // Une voix absente de la liste — désinstallée, ou enregistrée sur une
      // autre machine — laisse le select retomber sur l'option vide, qui est
      // justement le défaut. Rien à rattraper.
      voice.value = currentPrefs.voiceURI ?? ""
    }
    follow.checked = currentPrefs.follow
    updateMeta()
    updateSupertonicNote()
    if (isPopoverOpen && currentPrefs.engine === "supertonic") void refreshModelCached()
  }

  /** Reflète `modelCached` sur le texte et la visibilité de la note. */
  function updateSupertonicNote() {
    supertonicNote.hidden = currentPrefs.engine !== "supertonic" || modelCached !== false
    if (supertonicNote.hidden) return
    noteLead.textContent = browser.i18n.getMessage("optionsModelAlertPendingLead")
    noteRest.textContent = browser.i18n.getMessage("optionsModelAlertPending")
  }

  async function refreshModelCached() {
    const request = ++modelCacheRequest
    let cached: unknown
    try {
      cached = await browser.runtime.sendMessage({ type: MODEL_CACHE_QUERY })
    } catch {
      cached = undefined
    }
    if (request !== modelCacheRequest) return
    modelCached = typeof cached === "boolean" ? cached : undefined
    updateSupertonicNote()
    if (isPopoverOpen) fitPopover()
  }

  function renderVoices() {
    if (currentPrefs.engine === "supertonic") {
      voice.replaceChildren(...SUPERTONIC_VOICE_OPTIONS.map(([id, label]) => voiceChoice(id, label)))
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

  function closePopover(instant = false) {
    // Restoring the card moves its anchor; hide first to avoid an exit jump.
    const restoringCard = currentState !== "idle" && currentState !== "loading"
    isPopoverOpen = false
    popover.inert = true
    popover.toggleAttribute("data-instant", instant || restoringCard)
    popover.removeAttribute("data-open")
    settings.setAttribute("aria-expanded", "false")
    updateLayout()
  }

  function togglePopover(keyboard = false) {
    if (isPopoverOpen) return closePopover(keyboard)
    isPopoverOpen = true
    popover.inert = false
    popover.toggleAttribute("data-instant", keyboard)
    popover.setAttribute("data-open", "")
    settings.setAttribute("aria-expanded", "true")
    updateLayout()
    modelCached = undefined
    syncControls()
    fitPopover()
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

  function setState(
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
      if (wasLoading && state === "playing" && currentPrefs.engine === "supertonic") {
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
    detach: () => host.remove(),
    setState,
    setPosition,
    remove: () => {
      document.removeEventListener("click", onDocumentClick, true)
      document.removeEventListener("keydown", onDocumentKeydown, true)
      window.removeEventListener("resize", onWindowResize)
      speechSynthesis.removeEventListener("voiceschanged", renderVoices)
      host.remove()
    },
    updatePrefs: (prefs: ReaderPreferences) => {
      if (prefs.position !== currentPrefs.position) applyPosition(prefs.position, host)
      currentPrefs = prefs
      syncControls()
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
