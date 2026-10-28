import { useEffect, useRef, useState } from "react"
import { PronunciationSettings } from "../../../components/PronunciationSettings"
import { TranslationProvider, useTranslation } from "../../../hooks/useTranslation"
import type { ReaderPreferences } from "../../../lib/reader-prefs"
import { isCacheWritable, isModelCached, loadModelFiles, type DownloadProgress } from "../../../lib/supertonic/model-cache"

export function PdfPronunciationSettings({ prefs, locale }: { prefs: ReaderPreferences; locale: string }) {
  return <TranslationProvider language={locale === "fr" ? "fr" : "en"}>
    <Dictionary prefs={prefs} />
  </TranslationProvider>
}

function Dictionary({ prefs }: { prefs: ReaderPreferences }) {
  const t = useTranslation()
  const [modelCached, setModelCached] = useState(false)
  const [phase, setPhase] = useState<"idle" | "downloading" | "error" | "unavailable">("idle")
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const activeRef = useRef(true)

  async function refresh() {
    const [cached, writable] = await Promise.all([isModelCached(), isCacheWritable()])
    if (!activeRef.current) return
    setModelCached(cached)
    if (!writable && !controllerRef.current) setPhase("unavailable")
  }

  useEffect(() => {
    activeRef.current = true
    void refresh()
    return () => {
      activeRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  async function download() {
    if (controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setPhase("downloading")
    setCancelled(false)
    setProgress(null)
    let onAbort: (() => void) | undefined
    try {
      if (!await isCacheWritable()) {
        if (activeRef.current) setPhase("unavailable")
        return
      }
      await Promise.race([
        loadModelFiles((next) => {
          if (activeRef.current && !controller.signal.aborted) setProgress(next)
        }, controller.signal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new DOMException("Aborted", "AbortError"))
          controller.signal.addEventListener("abort", onAbort, { once: true })
          if (controller.signal.aborted) onAbort()
        }),
      ])
      const cached = await isModelCached()
      if (!activeRef.current) return
      setModelCached(cached)
      setPhase(cached ? "idle" : "unavailable")
    } catch {
      if (!activeRef.current) return
      setPhase(controller.signal.aborted ? "idle" : "error")
      setCancelled(controller.signal.aborted)
    } finally {
      if (onAbort) controller.signal.removeEventListener("abort", onAbort)
      controllerRef.current = null
      if (activeRef.current) setProgress(null)
    }
  }

  const progressLabel = progress
    ? t("pdfPronunciationModelProgress", [String(progress.fileIndex + 1), String(progress.totalFiles)])
    : t("pdfPronunciationModelPreparing")
  const progressValue = progress
    ? progress.fileIndex + (progress.phase === "cached" ? 1 : progress.bytesTotal ? progress.bytesLoaded / progress.bytesTotal : 0)
    : 0

  return <details className="card pdf-pronunciation" onToggle={(event) => { if (event.currentTarget.open) void refresh() }}>
    <summary>
      {t("optionsSectionPronunciation")}
      {phase === "downloading" && <span className="pdf-pronunciation-summary-status">{t("pdfPronunciationModelDownloading")}</span>}
    </summary>
    <p className="help pdf-pronunciation-local">{t("pdfPronunciationLocal")}</p>
    <PronunciationSettings prefs={prefs} modelCached={modelCached} context="pdf" />
    {(prefs.engine === "supertonic" || phase === "downloading" || phase === "error") && <section className="section pdf-pronunciation-model" id="modele" aria-labelledby="pdf-pronunciation-model-heading">
      <h3 id="pdf-pronunciation-model-heading" className="row-label">{t("optionsSectionModel")}</h3>
      {modelCached ? <p className="help" role="status">{t("optionsModelReady")}</p> : phase === "unavailable" ? (
        <p className="help" role="alert">{t("pdfPronunciationModelUnavailable")}</p>
      ) : phase === "downloading" ? (
        <>
          <p className="help" role="status">{progressLabel}</p>
          <progress value={progressValue} max={progress?.totalFiles || 1} aria-label={progressLabel} />
          <p className="help">{t("pdfPronunciationModelDownloadHelp")}</p>
          <button type="button" onClick={() => controllerRef.current?.abort()}>{t("optionsModelCancel")}</button>
        </>
      ) : (
        <>
          <p className="help" role={phase === "error" ? "alert" : "status"}>
            {t(phase === "error" ? "optionsModelError" : cancelled ? "pdfPronunciationModelCancelled" : "pdfPronunciationModelHelp")}
          </p>
          <button type="button" onClick={() => void download()}>{t(phase === "error" || cancelled ? "optionsModelRetry" : "optionsModelDownloadCta")}</button>
        </>
      )}
    </section>}
  </details>
}
