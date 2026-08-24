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
import { createAnchorFinder } from "../lib/read-anchor.ts"
import { buildReadingIntro } from "../lib/reading-intro"
import { toSupertonicLang, type SupportedLang } from "../lib/supertonic-lang.ts"
import { detectLang } from "../lib/detect-lang.ts"
import {
  TTS_CONTROL,
  TTS_EVENT,
  TTS_SET_SPEED,
  TTS_SPEAK,
  type TtsControlMessage,
  type TtsEventMessage,
  type TtsLoadingReason,
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

    const pill = createPill(onPrimary, onSecondary, prefs, !isHidden(location.hostname, hiddenSites), uiPrefs.theme)
    const follower = createFollower()
    follower.setEnabled(prefs.follow)

    browser.runtime.onMessage.addListener(onMessage)
    browser.runtime.onMessage.addListener(onTtsEvent)
    browser.storage.onChanged.addListener(onTokenChanged)
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
    })
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage)
      browser.runtime.onMessage.removeListener(onTtsEvent)
      browser.storage.onChanged.removeListener(onTokenChanged)
      unsubscribePrefs()
      unsubscribeHiddenSites()
      unsubscribeUiPrefs()
      cancelSpeech()
      follower.end()
      pill.remove()
    })

    function onMessage(message: Partial<StartReadingMessage>) {
      if (message?.type !== START_READING || !message.text) return
      start(message as ReadPagePayload)
    }

    /** Événements de l'hôte Supertonic : pilotent directement la pastille. */
    function onTtsEvent(message: Partial<TtsEventMessage>) {
      if (message?.type !== TTS_EVENT || !message.state) return
      const state = message.state
      if (state.phase === "loading") {
        // Le toast ne sort que pour une attente étiquetée : téléchargement du
        // modèle, chargement du moteur ou de la voix, et — pendant la lecture
        // — le hoquet où l'unité suivante n'a pas fini de se synthétiser (RTF
        // > 1, voir tts-host.ts). Les transitions déjà prêtes, elles, sont
        // instantanées et n'émettent jamais cet état.
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
          label ?? supertonicTitle,
          true,
          label ? { label, percent: state.progress } : undefined
        )
      } else if (state.phase === "playing") {
        if (sawSupertonicDownload) {
          sawSupertonicDownload = false
          track({ name: "supertonic_download_completed" })
        }
        paused = false
        follower.show(state.block)
        pill.setState("playing", supertonicTitle)
      } else if (state.phase === "paused") {
        paused = true
        pill.setState("paused")
      } else if (state.phase === "ended") {
        track({ name: "read_completed" })
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
      if (!started && !reading) pill.setState("idle")
    }

    /** ⏹ pendant la lecture, ✕ au repos : ne plus afficher Orateur sur ce domaine. */
    function onSecondary() {
      if (reading) return stop()
      pill.detach()
      void addHiddenSite(location.hostname)
    }

    /** Choisit le moteur, puis démarre — le reste ne se recroise plus. */
    function start(payload: ReadPagePayload) {
      if (prefs.engine === "supertonic") {
        // La déclaration de la page d'abord ; si elle manque ou sort du
        // modèle, une détection sur le texte réel avant d'abandonner —
        // beaucoup de pages ne déclarent aucun `lang`.
        const supertonicLang =
          toSupertonicLang(payload.lang ?? "") ?? detectLang(payload.text, null)
        if (supertonicLang) {
          startSupertonic(payload, supertonicLang)
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
      startSystem(payload)
    }

    function startSupertonic(payload: ReadPagePayload, lang: SupportedLang) {
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
      reading = true
      paused = false
      sawSupertonicDownload = false
      supertonicTitle = payload.title ?? ""
      track({ name: "read_started", properties: { engine: "supertonic" } })
      void browser.storage.local.set({ [READER_TOKEN]: token })
      pill.attach()
      pill.setState("loading", supertonicTitle, true)
      void browser.runtime.sendMessage({
        type: TTS_SPEAK,
        text,
        title: payload.title,
        lang,
        voice: prefs.supertonicVoice,
        speed: prefs.speed,
        token,
      } satisfies Partial<TtsSpeakMessage>)
    }

    function startSystem(payload: ReadPagePayload) {
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

      blockIndex = 0
      charIndex = 0
      lang = resolvedLang
      reading = true
      paused = false
      stale = false
      track({ name: "read_started", properties: { engine: "system" } })
      // Prendre la parole : les pastilles des autres onglets s'en déduisent.
      void browser.storage.local.set({ [READER_TOKEN]: token })
      // La pastille a pu être masquée : une lecture lancée depuis le menu
      // contextuel doit quand même offrir de quoi l'arrêter.
      pill.attach()
      pill.setState("playing", payload.title ?? "")
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
      follower.end()
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
.pill-row {
  /*
   * Tokens posés ici et pas sur :host — le style inline posé par
   * applyPosition() porte un all:initial!important qui écraserait tout ce
   * qu'on y déclarerait. Le popover en hérite : une seule matière pour les deux.
   */
  accent-color: var(--primary);

  /*
   * Les deux calques flottants (toast, popover) suivent la position de la
   * pastille. Leur transform mélange trois rôles — centrage, échelle,
   * glissement d'entrée : en sortir le centrage et le glissement permet aux
   * variantes plus bas de n'en réécrire qu'une part, sans jamais redéclarer
   * transform. C'est ce qui garde les règles prefers-reduced-motion
   * gagnantes : elles ont une spécificité plus faible que les variantes.
   */
  --toast-center: translateY(-50%);
  --toast-slide: translateX(12px);
  --pop-slide: translateY(4px);
  --pop-origin-x: right;
  --pop-origin-y: bottom;

  display: inline-flex;
  align-items: center;
  padding: 6px;
  border-radius: 999px;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  color: var(--foreground);
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
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
button:hover:not(:disabled) { background: color-mix(in srgb, var(--foreground) 8%, transparent) }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
button:disabled { opacity: 0.55; cursor: default }
/* Le pressé doit s'entendre tout de suite : le retour est sur l'appui, pas au
   relâchement. */
button:active:not(:disabled) { transform: scale(0.97) }
button { transition: transform 160ms var(--ease-out) }
/*
 * Bouton principal (▶/⏸) : seul rempli de la pastille, à la couleur de marque
 * — c'est lui qui lance ou suspend la lecture, les deux autres ne font
 * qu'accompagner ou interrompre.
 */
.pill-primary { background: var(--primary); color: var(--primary-foreground) }
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
button[data-icon="sliders"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M4 7h5M15 7h5M4 12h9M19 12h1M4 17h3M13 17h7'/%3E%3Ccircle cx='12' cy='7' r='2.5'/%3E%3Ccircle cx='16' cy='12' r='2.5'/%3E%3Ccircle cx='10' cy='17' r='2.5'/%3E%3C/svg%3E");
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
/* Anneau tournant : le "loader-circle" de lucide, déjà utilisé par le spinner
   du toast — même geste, même icône. */
button[data-icon="loader-circle"] {
  --icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12a9 9 0 1 1-6.219-8.56'/%3E%3C/svg%3E");
  animation: loading-spin 700ms linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  button[data-icon="loader-circle"] { animation-duration: 1400ms }
}
/*
 * Au repos la pastille se replie sur ses deux boutons : le titre garde son
 * texte mais tombe à une largeur nulle. Une largeur n'a pas d'équivalent en
 * transform — même exception que pour un accordéon.
 *
 * Visé par sa classe, pas par le sélecteur span : le popover de réglages en
 * contient d'autres, que la règle repliait avec le titre — intitulés et
 * valeurs disparaissaient tant que la pastille n'était pas en train de lire.
 */
.pill-title {
  max-width: 0;
  margin: 0;
  opacity: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    max-width 200ms var(--ease-out),
    margin 200ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
:host([data-expanded]) .pill-title {
  max-width: 220px;
  margin: 0 6px;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .pill-title { transition: opacity 120ms ease-out }
}
.settings-popover {
  position: absolute;
  bottom: 100%;
  right: 0;
  /* Même fond que la pastille : le popover en est le prolongement, pas une
     surface étrangère posée dessus. Le liseré fait l'arête. */
  background: var(--card);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: 12px;
  min-width: 210px;
  color: var(--foreground);
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.95) var(--pop-slide);
  /* Un popover s'ouvre depuis ce qui l'a ouvert : sans ça il grandit depuis son
     centre et le lien avec le bouton se perd. */
  transform-origin: var(--pop-origin-x) var(--pop-origin-y);
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
  transform: scale(1);
}
/*
 * Pastille jumelle, pas un popover : même hauteur de ligne que .pill-row,
 * mêmes bouts entièrement arrondis. Dockée à gauche par défaut — c'est là qu'il
 * reste de la place quand la pastille est plaquée contre le bord droit. Les
 * variantes plus bas la redockent selon la position choisie.
 */
.loading-toast {
  position: absolute;
  top: 50%;
  right: 100%;
  margin-right: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border-radius: 999px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: 6px 14px 6px 10px;
  max-width: 220px;
  color: var(--foreground);
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: var(--toast-center) scale(0.95) var(--toast-slide);
  transform-origin: center right;
  transition:
    opacity 150ms var(--ease-out),
    transform 150ms var(--ease-out);
  z-index: 10000;
}
.loading-toast[data-open] {
  opacity: 1;
  pointer-events: auto;
  transform: var(--toast-center) scale(1);
}
@media (prefers-reduced-motion: reduce) {
  /* --toast-center et pas translateY(-50%) en dur : aux positions *-center le
     toast est centré horizontalement, pas verticalement. */
  .loading-toast { transform: var(--toast-center); transition: opacity 120ms ease-out }
  .loading-toast[data-open] { transform: var(--toast-center) }
}

/* ── Le toast et le popover suivent la position de la pastille ───────────
 *
 * Deux axes indépendants lus sur l'attribut posé par applyPosition() :
 * ^="top" bascule le popover vers le bas, $="left" renvoie le toast à
 * droite de la pastille et aligne le popover à gauche. Sans ça les deux
 * calques sortent de l'écran sur 4 des 6 positions.
 */
:host([data-orateur-position$="left"]) .pill-row {
  --toast-slide: translateX(-12px);
  --pop-origin-x: left;
}
:host([data-orateur-position$="left"]) .loading-toast {
  right: auto;
  left: 100%;
  margin-right: 0;
  margin-left: 8px;
  transform-origin: center left;
}
:host([data-orateur-position$="left"]) .settings-popover {
  right: auto;
  left: 0;
}
:host([data-orateur-position^="top"]) .pill-row {
  --pop-slide: translateY(-4px);
  --pop-origin-y: top;
}
:host([data-orateur-position^="top"]) .settings-popover {
  bottom: auto;
  top: 100%;
  margin-bottom: 0;
  margin-top: 8px;
}
/*
 * Au centre, le toast s'empile au-dessus de la pastille au lieu de se poser à
 * côté : il n'y a plus qu'un demi-écran à sa gauche, et sous ~420px de large il
 * rognait.
 */
:host([data-orateur-position$="center"]) .pill-row {
  --toast-center: translateX(-50%);
  --toast-slide: translateY(4px);
}
:host([data-orateur-position$="center"]) .loading-toast {
  top: auto;
  right: auto;
  bottom: 100%;
  left: 50%;
  margin: 0 0 8px;
  transform-origin: bottom center;
}
/* Après le bloc $="center" : même spécificité, seul l'ordre départage. */
:host([data-orateur-position="top-center"]) .pill-row {
  --toast-slide: translateY(-4px);
}
:host([data-orateur-position="top-center"]) .loading-toast {
  bottom: auto;
  top: 100%;
  margin: 8px 0 0;
  transform-origin: top center;
}
/*
 * Empilé, le toast occupe la place où s'ouvre le popover — et il est justement
 * visible pendant le téléchargement du modèle, l'instant où l'on ouvre les
 * réglages pour changer de moteur. Popover ouvert, le toast reprend donc sa
 * place latérale. Le combinateur frère fonctionne parce que le popover est
 * inséré avant le toast dans .pill-row. Redéclarer les variables sur l'élément
 * lui-même écrase celles héritées de .pill-row : le bloc est autonome.
 *
 * ponytail: seuls opacity et transform sont en transition — le retour latéral
 * fait donc glisser le transform pendant que top/right/margin sautent.
 * Transitoire et rare ; poser transition:none ici si ça pique.
 */
:host([data-orateur-position$="center"]) .settings-popover[data-open] ~ .loading-toast {
  --toast-center: translateY(-50%);
  --toast-slide: translateX(12px);
  top: 50%;
  bottom: auto;
  right: 100%;
  left: auto;
  margin: 0 8px 0 0;
  transform-origin: center right;
}
.loading-toast-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Anneau tournant : attente sans pourcentage connu (moteur, voix). */
.loading-toast-spinner {
  display: none;
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 999px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  animation: loading-spin 700ms linear infinite;
}
.loading-toast[data-mode="indeterminate"] .loading-toast-spinner { display: block }
@media (prefers-reduced-motion: reduce) {
  .loading-toast-spinner { animation-duration: 1400ms }
}
@keyframes loading-spin {
  to { transform: rotate(360deg) }
}
/* Barre déterminée : pourcentage connu (téléchargement du modèle). */
.loading-toast-bar {
  display: none;
  width: 48px;
  height: 4px;
  flex: none;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}
.loading-toast[data-mode="determinate"] .loading-toast-bar { display: block }
.loading-toast-bar-fill {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: left;
  background: var(--primary);
  transition: transform 150ms linear;
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
.settings-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
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
  font-size: 12px;
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
  font-size: 11px;
  line-height: 1.4;
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
  initialPrefs: ReaderPreferences,
  attached: boolean,
  initialTheme: ColorTheme
) {
  // Résolu ici, pas en haut du module : WXT importe ce fichier sous un faux
  // `browser` (sans `i18n`) pour en lire la config au build, et createPill ne
  // tourne qu'au vrai runtime du content script, appelé depuis main().
  const ARIA: Record<PillState, { primary: string; secondary: string }> = {
    idle: { primary: browser.i18n.getMessage("ariaReadPage"), secondary: browser.i18n.getMessage("ariaHidePill") },
    loading: { primary: browser.i18n.getMessage("ariaExtracting"), secondary: browser.i18n.getMessage("ariaHidePill") },
    playing: { primary: browser.i18n.getMessage("ariaPause"), secondary: browser.i18n.getMessage("ariaStopReading") },
    paused: { primary: browser.i18n.getMessage("ariaResume"), secondary: browser.i18n.getMessage("ariaStopReading") },
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
  applyPosition(initialPrefs.position, host)
  applyTheme(initialTheme, host)

  const root = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = PILL_CSS
  root.append(style)

  const row = document.createElement("div")
  row.className = "pill-row"
  const primary = button(onPrimary)
  primary.className = "pill-primary"
  const label = document.createElement("span")
  label.className = "pill-title"
  const secondary = button(onSecondary)
  const settings = button(() => togglePopover())
  // Posé une fois : l'icône et son intitulé ne dépendent pas de l'état de
  // lecture, contrairement à ceux de ▶ et ⏹.
  settings.dataset.icon = "sliders"
  settings.setAttribute("aria-label", browser.i18n.getMessage("ariaReadingSettings"))
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
  popover.setAttribute("aria-label", browser.i18n.getMessage("ariaReadingSettings"))
  row.append(popover)

  /**
   * Toast d'attente : téléchargement du modèle, chargement du moteur ou de
   * la voix Supertonic. Séparé de `label` (qui porte le titre de l'article)
   * pour ne jamais l'écraser — sans ça la pastille perdrait le titre affiché
   * pendant l'attente et devrait le retrouver au retour à "playing".
   */
  const toast = document.createElement("div")
  toast.className = "loading-toast"
  toast.setAttribute("role", "status")
  toast.setAttribute("aria-live", "polite")
  // `div` plutôt que `span` : sans conséquence ici, les deux sont mis en
  // forme par leur classe.
  const toastSpinner = document.createElement("div")
  toastSpinner.className = "loading-toast-spinner"
  toastSpinner.setAttribute("aria-hidden", "true")
  const toastLabel = document.createElement("div")
  toastLabel.className = "loading-toast-label"
  const toastBar = document.createElement("div")
  toastBar.className = "loading-toast-bar"
  const toastFill = document.createElement("div")
  toastFill.className = "loading-toast-bar-fill"
  toastBar.append(toastFill)
  toast.append(toastSpinner, toastLabel, toastBar)
  row.append(toast)

  let currentPrefs = initialPrefs
  let isPopoverOpen = false

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

  // Le coût du premier ▶ : Supertonic ne télécharge rien tant qu'on ne lit
  // pas, mais le dire à l'avance rend ce coût acceptable plutôt que subi.
  //
  // ponytail: texte statique, pas d'état « déjà téléchargé » — la pastille
  // n'a aucun moyen d'interroger l'OPFS de l'extension pour le savoir sans un
  // aller-retour de plus. La progression réelle, elle, passe par le libellé
  // de la pastille (setState("loading", "Téléchargement… 42%")) une fois la
  // lecture lancée.
  const supertonicNote = document.createElement("div")
  supertonicNote.className = "settings-note"
  const noteLead = document.createElement("strong")
  noteLead.textContent = browser.i18n.getMessage("supertonicNoteLead")
  const noteRest = document.createElement("div")
  noteRest.textContent = browser.i18n.getMessage("supertonicNoteSize")
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
    if (currentPrefs.engine === "supertonic") {
      voice.value = currentPrefs.supertonicVoice
    } else {
      // Une voix absente de la liste — désinstallée, ou enregistrée sur une
      // autre machine — laisse le select retomber sur l'option vide, qui est
      // justement le défaut. Rien à rattraper.
      voice.value = currentPrefs.voiceURI ?? ""
    }
    follow.checked = currentPrefs.follow
    supertonicNote.hidden = currentPrefs.engine !== "supertonic"
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

  // Site exclu (réglages → Sites) : la pastille reste montée en mémoire,
  // prête pour `pill.attach()`, mais hors du DOM tant que rien ne la demande.
  if (attached) attach()
  setState("idle")

  function setState(
    state: PillState,
    title?: string,
    interruptible = false,
    toastInfo?: { label: string; percent?: number }
  ) {
    primary.dataset.icon = LABELS[state].primary
    primary.setAttribute("aria-label", ARIA[state].primary)
    secondary.dataset.icon = LABELS[state].secondary
    secondary.setAttribute("aria-label", ARIA[state].secondary)
    // Rien à annuler tant que l'extraction tourne : quelques centaines de
    // millisecondes, plus simple à neutraliser qu'à interrompre. Supertonic
    // réutilise ce même état "loading" pour des attentes de plusieurs
    // secondes (téléchargement, synthèse entre blocs) — `interruptible` en
    // sort les deux appelants concernés, sinon ⏸/⏹ resteraient morts
    // précisément quand l'utilisateur veut s'en servir.
    primary.disabled = secondary.disabled = state === "loading" && !interruptible
    // Le titre n'est réécrit que quand on en fournit un : une pause ne doit
    // pas le perdre — donc pas replier la pastille — juste changer l'icône.
    if (title !== undefined) label.textContent = title
    host.toggleAttribute("data-expanded", state === "playing" || state === "paused")

    toast.toggleAttribute("data-open", toastInfo !== undefined)
    if (toastInfo) {
      toastLabel.textContent = toastInfo.label
      toast.dataset.mode = toastInfo.percent === undefined ? "indeterminate" : "determinate"
      if (toastInfo.percent !== undefined) toastFill.style.transform = `scaleX(${toastInfo.percent / 100})`
    }
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
    remove: () => {
      document.removeEventListener("click", onDocumentClick, true)
      document.removeEventListener("keydown", onDocumentKeydown, true)
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
