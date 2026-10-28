import { useEffect, useRef, useState } from "react"
import { downloadPdf, isFileAccessAllowed, parsePdfSource } from "../../../../lib/pdf-source"
import { extractPdf } from "../../../../lib/pdf-extract"
import { PDF_MAX_BYTES, PdfError } from "../../../../lib/pdf-types"
import { createPdfSystemPlayer, choosePdfVoice, localPdfVoices } from "../../../../lib/pdf-player"
import { createTtsHost, splitBlocks, type TtsHost } from "../../../../lib/tts-host"
import { SPEED, savePrefs, type ReaderPreferences } from "../../../../lib/reader-prefs"
import { detectLang } from "../../../../lib/detect-lang"
import { toSupertonicLang } from "../../../../lib/supertonic-lang"
import { SUPERTONIC_VOICES, SUPERTONIC_VOICE_LABEL_KEYS, type SupertonicVoice } from "../../../../lib/supertonic/types"
import type { TtsState } from "../../../../lib/tts-messages"
import { loadPronunciationRules } from "../../../../lib/pronunciation-rules"
import { PdfPronunciationSettings } from "../../components/PdfPronunciationSettings"

const READER_TOKEN = "orateur:reading-tab"
type Translate = (key: string, substitutions?: string[]) => string
type Source = string | File
type Progress = { phase: "downloading"; loaded: number; total?: number } | { phase: "extracting"; completed: number; total: number }
type DocumentText = { text: string; paragraphs: string[]; title: string; lang: string; pageCount: number }
type Playback = TtsState | { phase: "idle" }

function sourceName(source: Source) {
  if (typeof source !== "string") return source.name
  try { return decodeURIComponent(new URL(source).pathname.split("/").pop() || "PDF") }
  catch { return "PDF" }
}

export function App({ initialPrefs, locale, t }: { initialPrefs: ReaderPreferences; locale: string; t: Translate }) {
  const [prefs, setPrefs] = useState<ReaderPreferences>({
    ...initialPrefs,
    engine: initialPrefs.engine === "supertonic" ? "supertonic" : "system",
    supertonicVoice: SUPERTONIC_VOICES.includes(initialPrefs.supertonicVoice) ? initialPrefs.supertonicVoice : "F1",
  })
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [doc, setDoc] = useState<DocumentText | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [sourceLabel, setSourceLabel] = useState("")
  const [playback, setPlayback] = useState<Playback>({ phase: "idle" })
  const [block, setBlock] = useState(-1)
  const abort = useRef<AbortController | null>(null)
  const source = useRef<Source | null>(null)
  const live = useRef(true)
  const readingGeneration = useRef(0)
  const token = useRef(crypto.randomUUID())
  const engine = useRef<"system" | "supertonic" | null>(null)
  const system = useRef<ReturnType<typeof createPdfSystemPlayer> | null>(null)
  const supertonic = useRef<TtsHost | null>(null)
  const currentParagraph = useRef<HTMLParagraphElement | null>(null)

  const resolvedVoice = choosePdfVoice(voices, prefs.voiceURI, doc?.lang ?? locale)
  const active = playback.phase === "playing" || playback.phase === "paused" || playback.phase === "loading"

  function receiveState(from: "system" | "supertonic", state: TtsState) {
    if (!live.current || engine.current !== from) return
    if (state.phase === "playing") setBlock(state.block)
    if (state.phase === "ended" || state.phase === "error") engine.current = null
    setPlayback(state)
  }

  function stop(cancelSystem = true) {
    readingGeneration.current++
    engine.current = null
    system.current?.stop(cancelSystem)
    supertonic.current?.control("stop")
    if (live.current) {
      setPlayback({ phase: "idle" })
      setBlock(-1)
    }
  }

  async function load(next: Source) {
    abort.current?.abort()
    stop()
    const controller = new AbortController()
    abort.current = controller
    source.current = next
    setSourceLabel(sourceName(next))
    setDoc(null)
    setError(null)
    setCancelled(false)
    setProgress({ phase: "downloading", loaded: 0 })
    const current = () => live.current && abort.current === controller && !controller.signal.aborted
    try {
      let bytes: Uint8Array
      if (typeof next === "string") {
        if (next.startsWith("file:") && !await isFileAccessAllowed()) throw new PdfError("file-access")
        if (!current()) return
        bytes = await downloadPdf(next, { signal: controller.signal, onProgress: (value) => { if (current()) setProgress(value) } })
      } else {
        if (next.size > PDF_MAX_BYTES) throw new PdfError("too-large")
        bytes = new Uint8Array(await next.arrayBuffer())
      }
      if (!current()) return
      setProgress({ phase: "extracting", completed: 0, total: 0 })
      const result = await extractPdf(bytes, {
        signal: controller.signal,
        workerSrc: new URL("pdf.worker.min.mjs", browser.runtime.getURL("/")).href,
        assetsUrl: new URL("pdf-assets/", browser.runtime.getURL("/")).href,
        onProgress: (value) => { if (current()) setProgress(value) },
      })
      if (!current()) return
      const lang = result.lang ?? detectLang(result.text, null) ?? locale
      const title = result.title?.trim() || sourceName(next)
      setDoc({ ...result, title, lang, paragraphs: splitBlocks(result.text) })
      document.title = `${title} — ${t("pdfTitle")}`
      setProgress(null)
    } catch (cause) {
      if (!current()) return
      setProgress(null)
      setError(cause instanceof PdfError ? cause.code : "invalid")
    }
  }

  function cancel() {
    abort.current?.abort()
    stop()
    setProgress(null)
    setCancelled(true)
  }

  useEffect(() => {
    live.current = true
    document.title = t("pdfTitle")
    const refreshVoices = () => setVoices(localPdfVoices(speechSynthesis.getVoices()))
    const navigate = () => {
      abort.current?.abort()
      stop()
      const url = parsePdfSource(location.hash)
      if (url) void load(url)
      else {
        setDoc(null)
        setProgress(null)
        setSourceLabel("")
        source.current = null
        setError(location.hash ? "invalid" : null)
      }
    }
    const loseOwnership = (changes: Record<string, { newValue?: unknown }>) => {
      if (READER_TOKEN in changes && changes[READER_TOKEN]?.newValue !== token.current) stop(false)
    }
    const leave = () => {
      abort.current?.abort()
      stop()
    }
    refreshVoices()
    speechSynthesis.addEventListener("voiceschanged", refreshVoices)
    browser.storage.onChanged.addListener(loseOwnership)
    window.addEventListener("hashchange", navigate)
    window.addEventListener("pagehide", leave)
    navigate()
    return () => {
      live.current = false
      leave()
      speechSynthesis.removeEventListener("voiceschanged", refreshVoices)
      browser.storage.onChanged.removeListener(loseOwnership)
      window.removeEventListener("hashchange", navigate)
      window.removeEventListener("pagehide", leave)
    }
  }, [])

  useEffect(() => {
    if (prefs.follow && block >= 0) currentParagraph.current?.scrollIntoView({ block: "nearest", behavior: "instant" })
  }, [block, prefs.follow])

  function updatePrefs(update: Partial<ReaderPreferences>) {
    const next = { ...prefs, ...update }
    setPrefs(next)
    void savePrefs(update).catch(() => {})
    if (update.speed !== undefined) {
      if (engine.current === "system") system.current?.setSpeed(next.speed)
      else if (engine.current === "supertonic") supertonic.current?.setSpeed(next.speed)
    } else if (update.engine || update.voiceURI || update.supertonicVoice) stop()
  }

  async function play() {
    if (!doc) return
    if (playback.phase === "playing" || playback.phase === "paused") {
      const action = playback.phase === "playing" ? "pause" : "resume"
      if (engine.current === "system") system.current?.control(action)
      else supertonic.current?.control(action)
      return
    }
    stop()
    const mine = ++readingGeneration.current
    engine.current = prefs.engine
    setPlayback({ phase: "loading" })
    try {
      const personalRules = await loadPronunciationRules()
      if (!live.current || mine !== readingGeneration.current) return
      await browser.storage.local.set({ [READER_TOKEN]: token.current })
      const owner = await browser.storage.local.get(READER_TOKEN)
      if (!live.current || mine !== readingGeneration.current) return
      if (owner[READER_TOKEN] !== token.current) return stop(false)
      // All PDF tabs share the native queue; owning the token precedes cancellation.
      speechSynthesis.resume()
      speechSynthesis.cancel()
      if (prefs.engine === "system") {
        system.current ??= createPdfSystemPlayer((state) => receiveState("system", state))
        system.current.speak({ paragraphs: doc.paragraphs, lang: doc.lang, speed: prefs.speed, voiceURI: resolvedVoice?.voiceURI ?? null, personalRules })
      } else {
        const lang = toSupertonicLang(doc.lang) ?? detectLang(doc.text, null)
        if (!lang) {
          engine.current = null
          setPlayback({ phase: "error", message: "language" })
          return
        }
        supertonic.current ??= createTtsHost((state) => receiveState("supertonic", state))
        supertonic.current.speak({ text: doc.text, lang, speed: prefs.speed, voice: prefs.supertonicVoice, personalRules })
      }
    } catch {
      stop()
      setPlayback({ phase: "error", message: "speech" })
    }
  }

  let playbackMessage = ""
  if (playback.phase === "loading") {
    playbackMessage = t(playback.reason === "downloading-model" ? "pdfModelDownloading" : "pdfPreparingVoice")
    if (playback.reason === "downloading-model" && playback.progress !== undefined) playbackMessage += ` ${Math.round(playback.progress * 100)} %`
  } else if (playback.phase === "error") {
    playbackMessage = t(playback.message === "no-local-voice" ? "pdfNoLocalVoice" : playback.message === "language" ? "pdfVoiceLanguage" : "pdfSpeechError")
  } else if (playback.phase === "ended") playbackMessage = t("pdfFinished")
  else if (playback.phase === "paused") playbackMessage = t("pdfPaused")
  else if (playback.phase === "playing") playbackMessage = t("pdfReadingParagraph", [String(playback.block + 1), String(playback.total)])

  const progressMessage = progress?.phase === "extracting"
    ? t("pdfExtracting", [String(progress.completed), String(progress.total)])
    : t("pdfDownloading")
  const progressValue = progress?.phase === "extracting" ? progress.completed : progress?.loaded
  const progressMax = progress?.total || undefined

  return <main className="page pdf-page">
    <header className="pdf-header">
      <div className="brand"><img src={browser.runtime.getURL("/icon/48.png")} alt="" /><span>{t("pdfTitle")}</span></div>
      <h1>{doc?.title || t("pdfHeading")}</h1>
      <p className="tagline">{t("pdfPrivacy")}</p>
      <label className="pdf-file-label">{t("pdfChooseFile")}
        <input type="file" accept="application/pdf,.pdf" onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void load(file)
          event.currentTarget.value = ""
        }} />
      </label>
      {sourceLabel && <p className="pdf-source">{sourceLabel}{doc ? ` · ${t("pdfPages", [String(doc.pageCount)])}` : ""}</p>}
    </header>

    <PdfPronunciationSettings prefs={{ ...prefs, voiceURI: resolvedVoice?.voiceURI ?? null }} locale={locale} />

    {progress && <section className="card pdf-status" aria-label={t("pdfProgress")}>
      <p role="status">{progressMessage}</p>
      <progress aria-label={progressMessage} value={progressMax ? progressValue : undefined} max={progressMax} />
      <button type="button" onClick={cancel}>{t("pdfCancel")}</button>
    </section>}
    {(error || cancelled) && <section className="card pdf-status">
      <p role={error ? "alert" : "status"}>{error ? t(`pdfError_${error.replaceAll("-", "_")}`) : t("pdfCancelled")}</p>
      {source.current && <button type="button" onClick={() => { if (source.current) void load(source.current) }}>{t("pdfRetry")}</button>}
    </section>}

    {doc && <>
      <section className="card pdf-controls" aria-label={t("pdfPlaybackControls")}>
        <div className="pdf-settings">
          <label>{t("pdfEngine")}<select value={prefs.engine} onChange={(event) => updatePrefs({ engine: event.target.value as ReaderPreferences["engine"] })}>
            <option value="system">{t("pdfSystemVoice")}</option><option value="supertonic">Supertonic</option>
          </select></label>
          <label>{t("pdfVoice")}<select value={prefs.engine === "system" ? resolvedVoice?.voiceURI ?? "" : prefs.supertonicVoice}
            disabled={prefs.engine === "system" && !voices.length}
            onChange={(event) => updatePrefs(prefs.engine === "system" ? { voiceURI: event.target.value } : { supertonicVoice: event.target.value as SupertonicVoice })}>
            {prefs.engine === "system" ? (voices.length ? voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>) : <option value="">{t("pdfNoLocalVoiceShort")}</option>)
              : SUPERTONIC_VOICES.map((voice) => <option key={voice} value={voice}>{t(SUPERTONIC_VOICE_LABEL_KEYS[voice])}</option>)}
          </select></label>
          <label>{t("pdfSpeed")}<select value={prefs.speed} onChange={(event) => updatePrefs({ speed: Number(event.target.value) })}>
            {Array.from({ length: Math.round((SPEED.max - SPEED.min) / SPEED.step) + 1 }, (_, i) => Number((SPEED.min + i * SPEED.step).toFixed(1))).map((speed) => <option value={speed} key={speed}>{speed.toFixed(1)}×</option>)}
          </select></label>
        </div>
        {prefs.engine === "supertonic" && <p className="pdf-help">{t("pdfModelNote")}</p>}
        {prefs.engine === "system" && !voices.length && <p className="pdf-help">{t("pdfNoLocalVoice")}</p>}
        <div className="pdf-actions">
          <button className="pdf-primary" type="button" onClick={() => void play()} disabled={playback.phase === "loading" || (prefs.engine === "system" && !voices.length)}>
            {t(playback.phase === "playing" ? "pdfPause" : playback.phase === "paused" ? "pdfResume" : "pdfRead")}
          </button>
          <button type="button" onClick={() => stop()} disabled={!active}>{t("pdfStop")}</button>
          <label className="pdf-follow"><input type="checkbox" checked={prefs.follow} onChange={(event) => updatePrefs({ follow: event.target.checked })} />{t("pdfFollow")}</label>
        </div>
        <p className="pdf-playback-status" role="status" aria-live="polite">{playbackMessage}</p>
      </section>
      <article className="card pdf-text" lang={doc.lang} aria-label={t("pdfExtractedText")}>
        {doc.paragraphs.map((paragraph, index) => <p key={index} ref={index === block ? currentParagraph : undefined} aria-current={index === block ? "true" : undefined}>{paragraph}</p>)}
      </article>
    </>}
    {!doc && !progress && !error && !cancelled && <p className="pdf-empty">{t("pdfEmpty")}</p>}
  </main>
}
