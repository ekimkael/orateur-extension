import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "../hooks/useTranslation"
import { createPronunciationPreview } from "../lib/pronunciation-preview"
import {
  loadPronunciationRules,
  onPronunciationRulesChanged,
  removePronunciationRule,
  upsertPronunciationRule,
} from "../lib/pronunciation-rules"
import {
  MAX_RULES,
  MAX_SOURCE_LENGTH,
  MAX_REPLACEMENT_LENGTH,
  validatePronunciationRule,
  type PronunciationRule,
} from "../lib/pronunciation/personal"
import type { ReaderPreferences } from "../lib/reader-prefs"
import type { TtsState } from "../lib/tts-messages"

type ValidationError = Extract<ReturnType<typeof validatePronunciationRule>, { ok: false }>

function emptyRule(): PronunciationRule {
  return { id: crypto.randomUUID(), language: "fr", source: "", replacement: "", caseSensitive: false }
}

export function PronunciationSettings({ prefs, modelCached, active = true }: { prefs: ReaderPreferences; modelCached: boolean; active?: boolean }) {
  const t = useTranslation()
  const id = useId()
  const [rules, setRules] = useState<PronunciationRule[]>([])
  const [draft, setDraft] = useState(emptyRule)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ValidationError | null>(null)
  const [storageError, setStorageError] = useState(false)
  const [status, setStatus] = useState<{ key: string; source: string } | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewState, setPreviewState] = useState<TtsState>({ phase: "ended" })
  const previewRef = useRef<ReturnType<typeof createPronunciationPreview> | null>(null)
  const previewAttemptRef = useRef(0)
  const formRef = useRef<HTMLFormElement>(null)
  const sourceRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    let changed = false
    const unsubscribe = onPronunciationRulesChanged((next) => {
      changed = true
      if (active) {
        setRules(next)
        setLoading(false)
        setLoadFailed(false)
      }
    })
    void loadPronunciationRules().then((next) => {
      if (active && !changed) setRules(next)
    }).catch(() => {
      if (active && !changed) setLoadFailed(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const preview = createPronunciationPreview(setPreviewState)
    previewRef.current = preview
    return () => {
      preview.stop()
      previewRef.current = null
    }
  }, [])

  useEffect(() => stopPreview(), [prefs.engine, prefs.voiceURI, prefs.supertonicVoice, prefs.speed, modelCached, active])

  function stopPreview() {
    previewAttemptRef.current++
    previewRef.current?.stop()
    setPreviewId(null)
    setPreviewState({ phase: "ended" })
  }

  function updateDraft(patch: Partial<PronunciationRule>) {
    stopPreview()
    setDraft((current) => ({ ...current, ...patch }))
    setError(null)
    setStorageError(false)
    setStatus(null)
  }

  function resetForm() {
    stopPreview()
    setDraft(emptyRule())
    setEditing(false)
    setError(null)
    setStorageError(false)
  }

  function showValidation(result: ValidationError) {
    setError(result)
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${result.field}"]`)?.focus())
  }

  async function reload() {
    setLoading(true)
    setLoadFailed(false)
    try {
      setRules(await loadPronunciationRules())
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setStorageError(false)
    setStatus(null)
    const result = validatePronunciationRule(draft, rules)
    if (!result.ok) {
      showValidation(result)
      return
    }
    stopPreview()
    setBusy(true)
    try {
      const saved = await upsertPronunciationRule(result.rule)
      if (!saved.ok) {
        showValidation(saved)
        return
      }
      setRules((current) => current.some((rule) => rule.id === saved.rule.id)
        ? current.map((rule) => rule.id === saved.rule.id ? saved.rule : rule)
        : [...current, saved.rule])
      setStatus({ key: "pronunciationSaved", source: saved.rule.source })
      resetForm()
      requestAnimationFrame(() => sourceRef.current?.focus())
    } catch {
      setStorageError(true)
    } finally {
      setBusy(false)
    }
  }

  function edit(rule: PronunciationRule) {
    stopPreview()
    setDraft({ ...rule })
    setEditing(true)
    setError(null)
    setStorageError(false)
    setStatus(null)
    sourceRef.current?.focus()
  }

  async function remove(rule: PronunciationRule) {
    setBusy(true)
    setStorageError(false)
    setStatus(null)
    stopPreview()
    try {
      await removePronunciationRule(rule.id)
      setRules((current) => current.filter((entry) => entry.id !== rule.id))
      if (draft.id === rule.id) resetForm()
      setStatus({ key: "pronunciationDeleted", source: rule.source })
      requestAnimationFrame(() => sourceRef.current?.focus())
    } catch {
      setStorageError(true)
    } finally {
      setBusy(false)
    }
  }

  async function listen(rule: PronunciationRule, isDraft = false) {
    if (previewId === rule.id && previewActive) {
      stopPreview()
      return
    }
    const result = validatePronunciationRule(rule, isDraft ? rules : [])
    if (!result.ok) {
      showValidation(result)
      return
    }
    stopPreview()
    setPreviewId(rule.id)
    setPreviewState({ phase: "loading" })
    const attempt = previewAttemptRef.current
    try {
      await previewRef.current?.speak(result.rule, prefs)
    } catch (cause) {
      if (attempt === previewAttemptRef.current) setPreviewState({ phase: "error", message: cause instanceof Error ? cause.message : "" })
    }
  }

  function errorMessage(failure: ValidationError) {
    const limit = failure.code === "limit" ? MAX_RULES : failure.field === "source" ? MAX_SOURCE_LENGTH : MAX_REPLACEMENT_LENGTH
    return t(`pronunciationError_${failure.code}`, [String(limit)])
  }

  function previewErrorMessage(state: Extract<TtsState, { phase: "error" }>) {
    if (["model-unavailable", "invalid-rule", "no-voice"].includes(state.message)) {
      return t(`pronunciationPreviewError_${state.message}`)
    }
    return `${t("pronunciationPreviewError")}${state.reason !== "audio-playback" && state.message ? ` ${state.message}` : ""}`
  }

  const previewActive = previewState.phase === "loading" || previewState.phase === "playing" || previewState.phase === "paused"
  const modelMissing = prefs.engine === "supertonic" && (!modelCached || previewState.phase === "error" && previewState.message === "model-unavailable")
  const disabled = loading || loadFailed || busy
  const fieldError = (field: ValidationError["field"]) => error?.field === field
  const previewButton = (rule: PronunciationRule, isDraft = false) => (
    <button
      type="button"
      className="pronunciation-button"
      disabled={disabled || modelMissing}
      onClick={() => void listen(rule, isDraft)}
      aria-label={t(previewId === rule.id && previewActive ? "pronunciationStopRule" : "pronunciationListenRule", [rule.source])}
      aria-describedby={`${id}-preview-help`}
    >
      {previewId === rule.id && previewActive ? t("pronunciationStop") : t("pronunciationListen")}
    </button>
  )

  return (
    <section className="section" id="prononciation" hidden={!active} aria-labelledby={`${id}-heading`}>
      <h2 className="eyebrow" id={`${id}-heading`} tabIndex={-1}>{t("optionsSectionPronunciation")}</h2>
      <p className="help pronunciation-intro">{t("pronunciationHelp")}</p>
      <p className="help">{t("pronunciationNumbersHelp")}</p>
      <details className="pronunciation-matching">
        <summary>{t("pronunciationMatchingDetails")}</summary>
        <p className="help">{t("pronunciationMatchingHelp")}</p>
      </details>

      <form ref={formRef} className="pronunciation-form" onSubmit={(event) => void save(event)} noValidate>
        <h3 className="row-label">{t(editing ? "pronunciationEditHeading" : "pronunciationAddHeading")}</h3>
        <div className="pronunciation-fields">
          <div className="row">
            <label className="row-label" htmlFor={`${id}-language`}>{t("pronunciationLanguage")}</label>
            <select
              id={`${id}-language`}
              name="language"
              value={draft.language}
              disabled={disabled}
              onChange={(event) => updateDraft({ language: event.target.value as PronunciationRule["language"] })}
              aria-invalid={fieldError("language") || undefined}
              aria-describedby={fieldError("language") ? `${id}-language-error` : undefined}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
            {fieldError("language") && <p id={`${id}-language-error`} className="help pronunciation-error" role="alert">{errorMessage(error!)}</p>}
          </div>
          <div className="row">
            <label className="row-label" htmlFor={`${id}-source`}>{t("pronunciationSource")}</label>
            <input
              id={`${id}-source`}
              ref={sourceRef}
              name="source"
              type="text"
              autoComplete="off"
              lang={draft.language}
              required
              value={draft.source}
              placeholder={t("pronunciationSourceExample")}
              disabled={disabled}
              onChange={(event) => updateDraft({ source: event.target.value })}
              aria-invalid={fieldError("source") || undefined}
              aria-describedby={`${id}-source-hint${fieldError("source") ? ` ${id}-source-error` : ""}`}
            />
            <p id={`${id}-source-hint`} className="help">{t("pronunciationLengthHint", [String(MAX_SOURCE_LENGTH)])}</p>
            {fieldError("source") && <p id={`${id}-source-error`} className="help pronunciation-error" role="alert">{errorMessage(error!)}</p>}
          </div>
          <div className="row">
            <label className="row-label" htmlFor={`${id}-replacement`}>{t("pronunciationReplacement")}</label>
            <input
              id={`${id}-replacement`}
              name="replacement"
              type="text"
              autoComplete="off"
              lang={draft.language}
              required
              value={draft.replacement}
              placeholder={t("pronunciationReplacementExample")}
              disabled={disabled}
              onChange={(event) => updateDraft({ replacement: event.target.value })}
              aria-invalid={fieldError("replacement") || undefined}
              aria-describedby={`${id}-replacement-hint${fieldError("replacement") ? ` ${id}-replacement-error` : ""}`}
            />
            <p id={`${id}-replacement-hint`} className="help">{t("pronunciationLengthHint", [String(MAX_REPLACEMENT_LENGTH)])}</p>
            {fieldError("replacement") && <p id={`${id}-replacement-error`} className="help pronunciation-error" role="alert">{errorMessage(error!)}</p>}
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" name="caseSensitive" checked={draft.caseSensitive} disabled={disabled} onChange={(event) => updateDraft({ caseSensitive: event.target.checked })} />
          <span>{t("pronunciationCaseSensitive")}</span>
        </label>
        <div className="pronunciation-actions">
          <button type="submit" className="pronunciation-button" disabled={disabled}>{t(busy ? "pronunciationSaving" : "pronunciationSave")}</button>
          {previewButton(draft, true)}
          {editing && <button type="button" className="btn-text" disabled={busy} onClick={() => { resetForm(); sourceRef.current?.focus() }}>{t("pronunciationCancel")}</button>}
        </div>
        {error?.field === "form" && <p className="help pronunciation-error" role="alert">{errorMessage(error)}</p>}
      </form>

      <p id={`${id}-preview-help`} className="help">{t("pronunciationPreviewHelp")}</p>
      {modelMissing && <p className="help pronunciation-link">{t("pronunciationModelMissing")} <a href="#modele">{t("pronunciationModelLink")}</a></p>}
      {previewState.phase === "loading" && <p className="help" role="status">{t("pronunciationPreviewLoading")}</p>}
      {previewState.phase === "error" && <p className="help pronunciation-error" role="alert">{previewErrorMessage(previewState)}</p>}
      {storageError && <p className="help pronunciation-error" role="alert">{t("pronunciationStorageError")}</p>}
      <p className="help" role="status">{status ? t(status.key, [status.source]) : ""}</p>

      <h3 className="row-label pronunciation-list-heading">{t("pronunciationRulesHeading", [String(rules.length), String(MAX_RULES)])}</h3>
      {loading ? <p className="help" role="status">{t("pronunciationLoading")}</p> : loadFailed ? (
        <div>
          <p className="help pronunciation-error" role="alert">{t("pronunciationLoadError")}</p>
          <button type="button" className="btn-text" onClick={() => void reload()}>{t("pronunciationRetry")}</button>
        </div>
      ) : rules.length === 0 ? <p className="help">{t("pronunciationEmpty")}</p> : (
        <ul className="pronunciation-list">
          {rules.map((rule) => (
            <li key={rule.id} className="pronunciation-item">
              <div className="pronunciation-rule-text">
                <span className="pronunciation-source" lang={rule.language}><bdi>{rule.source}</bdi></span>
                <span className="help" lang={rule.language}><bdi>{t("pronunciationReplacementValue", [rule.replacement])}</bdi></span>
                <span className="help">{rule.language === "fr" ? "Français" : "English"}{rule.caseSensitive ? ` · ${t("pronunciationCaseSensitive")}` : ""}</span>
              </div>
              <div className="pronunciation-actions">
                {previewButton(rule)}
                <button type="button" className="pronunciation-button" disabled={disabled} aria-label={t("pronunciationEditRule", [rule.source])} onClick={() => edit(rule)}>{t("pronunciationEdit")}</button>
                <button type="button" className="btn-danger" disabled={disabled} aria-label={t("pronunciationDeleteRule", [rule.source])} onClick={() => void remove(rule)}>{t("pronunciationDelete")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
