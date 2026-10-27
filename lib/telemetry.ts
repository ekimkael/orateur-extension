/**
 * Télémétrie activée par défaut, désactivable dans les réglages ; jamais d'URL ni de
 * texte libre parmi les propriétés envoyées : uniquement les événements et
 * propriétés fermées listées dans `TelemetryEvent`.
 *
 * `track()` ne parle jamais elle-même au réseau : en MV3, un `fetch()` émis
 * depuis un content script reste soumis à la CSP de la PAGE HÔTE (même en
 * isolated world) — un site à `connect-src` strict bloquerait silencieusement
 * l'appel s'il partait de reader.content.ts, corrompant la mesure sans
 * prévenir personne. `track()` relaie donc toujours au background via
 * `runtime.sendMessage` ; seule `handleTelemetryTrack()` — appelée uniquement
 * depuis background.ts, dont la CSP est celle de l'extension — fait le vrai
 * `fetch()`.
 *
 * À partir du jalon 2, le compte donnera côté serveur l'essentiel de
 * l'entonnoir (inscriptions, abonnements, rétention) : cette liste
 * d'événements ne couvre que ce que le serveur ne peut pas voir. Ne pas la
 * faire grossir sans y repenser.
 */

const CONSENT_KEY = "orateur:telemetry"

export interface TelemetryConsent {
  enabled: boolean
  /** Créé au premier usage actif ; effacé dès la désactivation. */
  distinctId: string | null
}

const DEFAULT_CONSENT: TelemetryConsent = { enabled: true, distinctId: null }

async function readTelemetryConsent(): Promise<TelemetryConsent> {
  const data = await browser.storage.local.get(CONSENT_KEY)
  return { ...DEFAULT_CONSENT, ...(data[CONSENT_KEY] as Partial<TelemetryConsent> | undefined) }
}

/**
 * Initialise une identité persistante si les statistiques sont actives.
 * Le verrou partagé entre options et background empêche deux premiers usages
 * de créer des identifiants différents ou d'écraser une désactivation.
 * Un choix désactivé déjà stocké reste prioritaire sur la valeur par défaut.
 */
export async function loadTelemetryConsent(): Promise<TelemetryConsent> {
  return navigator.locks.request(CONSENT_KEY, async () => {
    const consent = await readTelemetryConsent()
    if (consent.enabled && !consent.distinctId) {
      consent.distinctId = crypto.randomUUID()
      await browser.storage.local.set({ [CONSENT_KEY]: consent })
    }
    return consent
  })
}

/**
 * Active ou désactive la télémétrie.
 *
 * Désactiver efface `distinctId` plutôt que de le garder au cas où : rien ne
 * doit rester une fois le consentement retiré, même une simple activation à
 * venir n'a pas besoin de mémoire d'un identifiant passé.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await navigator.locks.request(CONSENT_KEY, async () => {
    const previous = await readTelemetryConsent()
    const distinctId = enabled ? (previous.distinctId ?? crypto.randomUUID()) : null
    await browser.storage.local.set({ [CONSENT_KEY]: { enabled, distinctId } satisfies TelemetryConsent })
    if (enabled && !previous.enabled) track({ name: "telemetry_enabled" })
  })
}

export function onTelemetryConsentChanged(callback: (consent: TelemetryConsent) => void) {
  const handler = (changes: Record<string, { newValue?: unknown }>) => {
    if (!(CONSENT_KEY in changes)) return
    const newVal = changes[CONSENT_KEY]!.newValue as Partial<TelemetryConsent> | undefined
    callback({ ...DEFAULT_CONSENT, ...newVal })
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}

export const TELEMETRY_TRACK = "orateur:telemetry:track"

/** Catalogue fermé — un événement en dehors de cette liste n'a rien à faire dans track(). */
export type TelemetryEvent =
  | { name: "telemetry_enabled"; properties?: undefined }
  | { name: "read_started"; properties: { engine: "system" | "supertonic" } }
  | { name: "read_completed"; properties: { engine: "system" | "supertonic"; had_errors: boolean } }
  | { name: "read_failed"; properties: { engine: "system" | "supertonic"; reason: "synthesis" | "audio_playback" | "preparation" } }
  | { name: "supertonic_offered"; properties?: undefined }
  | { name: "supertonic_download_started"; properties?: undefined }
  | { name: "supertonic_download_completed"; properties?: undefined }
  | { name: "supertonic_download_failed"; properties: { reason: "http" | "network" | "unknown" } }
  | { name: "extraction_failed"; properties: { reason: "not_injectable" | "not_article" | "pdf" | "fallback_text" } }

export interface TelemetryTrackMessage {
  type: typeof TELEMETRY_TRACK
  event: TelemetryEvent
}

/**
 * Fire-and-forget, y compris depuis background.ts lui-même — un aller-retour
 * `sendMessage` de plus est négligeable, et ça garde un seul chemin de code
 * plutôt que deux (appel direct ici, message ailleurs).
 */
export function track(event: TelemetryEvent): void {
  void browser.runtime.sendMessage({ type: TELEMETRY_TRACK, event } satisfies TelemetryTrackMessage).catch(() => {})
}

interface TelemetryEnvironment {
  WXT_POSTHOG_KEY?: string
  WXT_POSTHOG_REGION?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

/**
 * Les messages des content scripts sont une frontière de confiance : les
 * types TypeScript ne suffisent pas. Refuser tout champ ou toute valeur hors
 * catalogue empêche qu'un texte, une URL ou une fausse version soit transmis.
 */
function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!isRecord(value) || !Object.hasOwn(value, "name")) return false
  if (Object.keys(value).some((key) => key !== "name" && key !== "properties")) return false
  const properties = value.properties
  switch (value.name) {
    case "telemetry_enabled":
    case "supertonic_offered":
    case "supertonic_download_started":
    case "supertonic_download_completed":
      return properties === undefined
    case "read_started":
    case "read_completed":
    case "read_failed": {
      if (!isRecord(properties) || (properties.engine !== "system" && properties.engine !== "supertonic")) return false
      if (value.name === "read_started") return hasExactKeys(properties, ["engine"])
      if (value.name === "read_completed") {
        return hasExactKeys(properties, ["engine", "had_errors"]) && typeof properties.had_errors === "boolean"
      }
      return hasExactKeys(properties, ["engine", "reason"]) &&
        ["synthesis", "audio_playback", "preparation"].includes(properties.reason as string)
    }
    case "supertonic_download_failed":
    case "extraction_failed": {
      if (!isRecord(properties) || !hasExactKeys(properties, ["reason"])) return false
      const reasons = value.name === "supertonic_download_failed"
        ? ["http", "network", "unknown"]
        : ["not_injectable", "not_article", "pdf", "fallback_text"]
      return reasons.includes(properties.reason as string)
    }
    default:
      return false
  }
}

/**
 * Seule fonction qui parle vraiment au réseau — à appeler uniquement depuis
 * le gestionnaire TELEMETRY_TRACK de background.ts, jamais depuis un content
 * script (voir l'en-tête du fichier). La configuration WXT est embarquée au
 * build ; clé absente, fictive ou région inconnue désactivent les envois.
 * La région choisit un hôte fixe, jamais une URL fournie par un message.
 * Firefox doit aussi accorder sa permission de collecte ; une ancienne version
 * sans cette permission conserve la collecte désactivée.
 * L'environnement injectable permet de vérifier ce contrat sans WXT ni réseau.
 */
export async function handleTelemetryTrack(
  event: unknown,
  environment: TelemetryEnvironment = {
    WXT_POSTHOG_KEY: import.meta.env?.WXT_POSTHOG_KEY,
    WXT_POSTHOG_REGION: import.meta.env?.WXT_POSTHOG_REGION,
  },
): Promise<void> {
  const key = environment.WXT_POSTHOG_KEY
  const region = environment.WXT_POSTHOG_REGION
  if (!key || !/^phc_[A-Za-z0-9_-]+$/.test(key) || /replace|your_project/i.test(key)) return
  if (region !== "eu" && region !== "us") return
  if (!isTelemetryEvent(event)) return

  try {
    const manifest = browser.runtime.getManifest()
    if (manifest.browser_specific_settings?.gecko) {
      const permissions = await browser.permissions.getAll() as { data_collection?: string[] }
      if (!permissions.data_collection?.includes("technicalAndInteraction")) return
    }
    const consent = await loadTelemetryConsent()
    if (!consent.enabled || !consent.distinctId) return
    await fetch(`https://${region}.i.posthog.com/i/v0/e/`, {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: event.name,
        distinct_id: consent.distinctId,
        properties: {
          ...event.properties,
          extension_version: manifest.version,
        },
      }),
    })
  } catch {
    // Stockage ou réseau indisponible : jamais remonté à l'utilisateur,
    // jamais retenté — un événement perdu n'a aucune conséquence produit.
  }
}
