/**
 * Télémétrie opt-in (jalon 1c) — désactivée par défaut, jamais d'URL ni de
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
  /** Créé à la première activation, jamais avant ; effacé dès la désactivation. */
  distinctId: string | null
}

const DEFAULT_CONSENT: TelemetryConsent = { enabled: false, distinctId: null }

export async function loadTelemetryConsent(): Promise<TelemetryConsent> {
  const data = await browser.storage.local.get(CONSENT_KEY)
  return { ...DEFAULT_CONSENT, ...(data[CONSENT_KEY] as Partial<TelemetryConsent> | undefined) }
}

/**
 * Active ou désactive la télémétrie.
 *
 * Désactiver efface `distinctId` plutôt que de le garder au cas où : rien ne
 * doit rester une fois le consentement retiré, même une simple activation à
 * venir n'a pas besoin de mémoire d'un identifiant passé.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const distinctId = enabled ? ((await loadTelemetryConsent()).distinctId ?? crypto.randomUUID()) : null
  await browser.storage.local.set({ [CONSENT_KEY]: { enabled, distinctId } satisfies TelemetryConsent })
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
  | { name: "installed"; properties?: undefined }
  | { name: "read_started"; properties: { engine: "system" | "supertonic" } }
  | { name: "read_completed"; properties?: undefined }
  | { name: "supertonic_offered"; properties?: undefined }
  | { name: "supertonic_download_started"; properties?: undefined }
  | { name: "supertonic_download_completed"; properties?: undefined }
  | { name: "supertonic_download_failed"; properties: { reason: "http" | "network" | "unknown" } }
  | { name: "extraction_failed"; properties: { reason: "not_injectable" | "not_article" } }

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

// PostHog — un projet à toi, pas un secret : les clés de projet PostHog sont
// conçues pour être embarquées côté client (write-only, aucune lecture de
// données ne leur est possible). Remplace par ta clé et ta région avant
// d'activer la télémétrie en prod ; tant que POSTHOG_API_KEY garde ce
// placeholder, handleTelemetryTrack() ne fait jamais de requête.
const POSTHOG_API_KEY = "phc_REPLACE_WITH_YOUR_PROJECT_KEY"
const POSTHOG_HOST = "https://us.i.posthog.com"

/**
 * Seule fonction qui parle vraiment au réseau — à appeler uniquement depuis
 * le gestionnaire TELEMETRY_TRACK de background.ts, jamais depuis un content
 * script (voir l'en-tête du fichier).
 */
export async function handleTelemetryTrack(event: TelemetryEvent): Promise<void> {
  if (POSTHOG_API_KEY.startsWith("phc_REPLACE")) return
  const consent = await loadTelemetryConsent()
  if (!consent.enabled || !consent.distinctId) return

  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_API_KEY,
        event: event.name,
        distinct_id: consent.distinctId,
        properties: event.properties ?? {},
      }),
    })
  } catch {
    // Réseau absent, PostHog indisponible : jamais remonté à l'utilisateur,
    // jamais retenté — un événement perdu n'a aucune conséquence produit.
  }
}
