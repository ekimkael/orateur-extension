import assert from "node:assert/strict"
import test from "node:test"
import {
  loadTelemetryConsent,
  setTelemetryEnabled,
  track,
  handleTelemetryTrack,
  TELEMETRY_TRACK,
} from "./telemetry.ts"

/** Storage local en mémoire — même style que reader-prefs.test.ts. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  const sent: unknown[] = []
  ;(globalThis as any).browser = {
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
        set: async (entries: Record<string, unknown>) => Object.assign(data, entries),
      },
    },
    runtime: {
      getManifest: () => ({ version: "0.8.0" }),
      sendMessage: async (message: unknown) => {
        sent.push(message)
      },
    },
  }
  return { data, sent }
}

const KEY = "orateur:telemetry"
const CONFIG = { WXT_POSTHOG_KEY: "phc_testProject123", WXT_POSTHOG_REGION: "eu" }

async function withRequests(run: (requests: { url: string; body: any }[]) => Promise<void>) {
  const requests: { url: string; body: any }[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url, options) => {
    assert.equal(options?.credentials, "omit")
    assert.equal(options?.referrerPolicy, "no-referrer")
    requests.push({ url: String(url), body: JSON.parse(options!.body as string) })
    return new Response(null, { status: 200 })
  }) as typeof fetch
  try {
    await run(requests)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test("activée par défaut, avec un identifiant persistant dès le premier usage", async () => {
  const { data, sent } = fakeStorage()
  const consent = await loadTelemetryConsent()
  assert.equal(consent.enabled, true)
  assert.match(consent.distinctId!, /^[\da-f-]{36}$/)
  assert.deepEqual(data[KEY], consent)
  assert.deepEqual(await loadTelemetryConsent(), consent)
  assert.deepEqual(sent, [])
})

test("les premiers usages concurrents partagent un seul identifiant stocké", async () => {
  const { data } = fakeStorage()
  const storage = (globalThis as any).browser.storage.local
  const originalSet = storage.set
  let writes = 0
  storage.set = async (entries: Record<string, unknown>) => {
    writes++
    await originalSet(entries)
  }
  const consents = await Promise.all(Array.from({ length: 8 }, () => loadTelemetryConsent()))
  assert.equal(writes, 1)
  assert.equal(new Set(consents.map(({ distinctId }) => distinctId)).size, 1)
  assert.deepEqual(data[KEY], consents[0])
})

test("un refus stocké reste prioritaire sur l'activation par défaut", async () => {
  const { data } = fakeStorage({ [KEY]: { enabled: false, distinctId: null } })
  assert.deepEqual(await loadTelemetryConsent(), { enabled: false, distinctId: null })
  assert.deepEqual(data[KEY], { enabled: false, distinctId: null })
})

test("une désactivation pendant la première initialisation reste enregistrée", async () => {
  fakeStorage()
  const storage = (globalThis as any).browser.storage.local
  const originalGet = storage.get
  let releaseRead!: () => void
  let markRead!: () => void
  const firstRead = new Promise<void>((resolve) => { markRead = resolve })
  const resumeRead = new Promise<void>((resolve) => { releaseRead = resolve })
  let paused = false
  storage.get = async (key: string) => {
    const result = await originalGet(key)
    if (!paused) {
      paused = true
      markRead()
      await resumeRead
    }
    return result
  }
  const initializing = loadTelemetryConsent()
  await firstRead
  const optingOut = setTelemetryEnabled(false)
  releaseRead()
  await Promise.all([initializing, optingOut])
  assert.deepEqual(await loadTelemetryConsent(), { enabled: false, distinctId: null })
})

test("activer crée un identifiant et annonce l'accord après son stockage", async () => {
  const { data, sent } = fakeStorage({ [KEY]: { enabled: false, distinctId: null } })
  await setTelemetryEnabled(true)
  const consent = await loadTelemetryConsent()
  assert.equal(consent.enabled, true)
  assert.equal(typeof consent.distinctId, "string")
  assert.ok(consent.distinctId!.length > 0)
  assert.deepEqual(data[KEY], consent)
  assert.deepEqual(sent, [{ type: TELEMETRY_TRACK, event: { name: "telemetry_enabled" } }])
})

test("désactiver efface l'identifiant, pas seulement le drapeau", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "déjà-là" } })
  await setTelemetryEnabled(false)
  assert.deepEqual(await loadTelemetryConsent(), { enabled: false, distinctId: null })
})

test("activer deux fois de suite garde le même identifiant, ne le régénère pas", async () => {
  const { sent } = fakeStorage({ [KEY]: { enabled: true, distinctId: "stable-id" } })
  await setTelemetryEnabled(true)
  assert.equal((await loadTelemetryConsent()).distinctId, "stable-id")
  assert.deepEqual(sent, [])
})

test("désactiver puis réactiver crée un nouvel identifiant : l'ancien a été effacé", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "ancien-id" } })
  await setTelemetryEnabled(false)
  await setTelemetryEnabled(true)
  const { distinctId } = await loadTelemetryConsent()
  assert.notEqual(distinctId, "ancien-id")
  assert.equal(typeof distinctId, "string")
})

test("track() relaie toujours au background, jamais de fetch direct", async () => {
  const { sent } = fakeStorage()
  track({ name: "read_started", properties: { engine: "system" } })
  // fire-and-forget : laisser le microtask de sendMessage() s'exécuter.
  await Promise.resolve()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    type: TELEMETRY_TRACK,
    event: { name: "read_started", properties: { engine: "system" } },
  })
})

test("aucun envoi sans configuration, avec une clé fictive ou une région inconnue", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  await withRequests(async (requests) => {
    await handleTelemetryTrack({ name: "telemetry_enabled" })
    for (const config of [
      {},
      { ...CONFIG, WXT_POSTHOG_KEY: "" },
      { ...CONFIG, WXT_POSTHOG_KEY: "phc_REPLACE_WITH_YOUR_PROJECT_KEY" },
      { ...CONFIG, WXT_POSTHOG_KEY: "personal-api-key" },
      { WXT_POSTHOG_KEY: CONFIG.WXT_POSTHOG_KEY },
      { ...CONFIG, WXT_POSTHOG_REGION: "unknown" },
      { ...CONFIG, WXT_POSTHOG_REGION: "https://example.com" },
    ]) {
      await handleTelemetryTrack({ name: "telemetry_enabled" }, config)
    }
    assert.deepEqual(requests, [])
  })
})

test("handleTelemetryTrack() respecte un refus, même avec un identifiant résiduel", async () => {
  await withRequests(async (requests) => {
    for (const consent of [{ enabled: false, distinctId: null }, { enabled: false, distinctId: "ancien-id" }]) {
      fakeStorage({ [KEY]: consent })
      await handleTelemetryTrack({ name: "telemetry_enabled" }, CONFIG)
    }
    assert.deepEqual(requests, [])
  })
})

test("le premier événement est envoyé par défaut avec une identité conservée", async () => {
  const { data } = fakeStorage()
  await withRequests(async (requests) => {
    for (let i = 0; i < 2; i++) {
      await handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, CONFIG)
    }
    assert.equal(requests.length, 2)
    assert.equal(requests[0].body.distinct_id, (data[KEY] as any).distinctId)
    assert.equal(requests[1].body.distinct_id, requests[0].body.distinct_id)
  })
})

test("Firefox n'envoie rien sans autorisation native de collecte, même sur une ancienne version", async () => {
  await withRequests(async (requests) => {
    for (const permissions of [{}, { data_collection: [] }, { data_collection: ["none"] }]) {
      const { data } = fakeStorage()
      ;(globalThis as any).browser.runtime.getManifest = () => ({
        version: "0.8.0", browser_specific_settings: { gecko: { id: "orateur@test" } },
      })
      ;(globalThis as any).browser.permissions = { getAll: async () => permissions }
      await handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, CONFIG)
      assert.equal(data[KEY], undefined)
    }
    assert.deepEqual(requests, [])
  })
})

test("Firefox exige sa permission native et respecte encore la désactivation locale", async () => {
  await withRequests(async (requests) => {
    for (const enabled of [true, false]) {
      fakeStorage({ [KEY]: { enabled, distinctId: enabled ? "un-id" : null } })
      ;(globalThis as any).browser.runtime.getManifest = () => ({
        version: "0.8.0", browser_specific_settings: { gecko: { id: "orateur@test" } },
      })
      ;(globalThis as any).browser.permissions = {
        getAll: async () => ({ data_collection: ["technicalAndInteraction"] }),
      }
      await handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, CONFIG)
    }
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.distinct_id, "un-id")
  })
})

test("envoi valide vers la région choisie, avec identité consentante et version du background", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  await withRequests(async (requests) => {
    for (const region of ["eu", "us"]) {
      await handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, {
        ...CONFIG, WXT_POSTHOG_REGION: region,
      })
    }
    assert.deepEqual(requests, ["eu", "us"].map((region) => ({
      url: `https://${region}.i.posthog.com/i/v0/e/`,
      body: {
        api_key: CONFIG.WXT_POSTHOG_KEY,
        event: "read_started",
        distinct_id: "un-id",
        properties: { engine: "system", extension_version: "0.8.0" },
      },
    })))
  })
})

test("le catalogue accepte uniquement ses événements et leurs propriétés fermées", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  const events = [
    { name: "telemetry_enabled" },
    { name: "read_started", properties: { engine: "supertonic" } },
    { name: "read_completed", properties: { engine: "system", had_errors: false } },
    { name: "read_completed", properties: { engine: "supertonic", had_errors: true } },
    ...["synthesis", "audio_playback", "preparation"].map((reason) => ({ name: "read_failed", properties: { engine: "system", reason } })),
    { name: "supertonic_offered" },
    { name: "supertonic_download_started" },
    { name: "supertonic_download_completed" },
    ...["http", "network", "unknown"].map((reason) => ({ name: "supertonic_download_failed", properties: { reason } })),
    ...["not_injectable", "not_article", "pdf", "fallback_text"].map((reason) => ({ name: "extraction_failed", properties: { reason } })),
  ]
  await withRequests(async (requests) => {
    for (const event of events) await handleTelemetryTrack(event, CONFIG)
    assert.deepEqual(requests.map(({ body }) => ({ name: body.event, properties: body.properties })), events.map((event) => ({
      name: event.name,
      properties: { ...("properties" in event ? event.properties : {}), extension_version: "0.8.0" },
    })))
  })
})

test("refuse événements malformés, champs libres et version fournie par le content script", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  const events = [
    null, [], "read_started", {}, { name: "installed" },
    { name: "read_started" },
    { name: "read_started", properties: { engine: "other" } },
    { name: "read_started", properties: { engine: "system", url: "https://example.com" } },
    { name: "read_started", properties: { engine: "system", text: "article" } },
    { name: "read_started", properties: { engine: "system", title: "article" } },
    { name: "read_started", properties: { engine: "system", extension_version: "spoof" } },
    { name: "read_started", properties: { engine: "system" }, url: "https://example.com" },
    { name: "read_completed", properties: { engine: "system" } },
    { name: "read_completed", properties: { engine: "system", had_errors: "false" } },
    { name: "read_failed", properties: { engine: "system", reason: "texte libre" } },
    { name: "extraction_failed", properties: { reason: "https://example.com" } },
    { name: "supertonic_download_failed", properties: { reason: "network", error: "texte libre" } },
    { name: "telemetry_enabled", properties: { distinct_id: "autre-id" } },
  ]
  await withRequests(async (requests) => {
    for (const event of events) await handleTelemetryTrack(event, CONFIG)
    assert.deepEqual(requests, [])
  })
})

test("retirer l'accord empêche tout nouvel envoi", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  await withRequests(async (requests) => {
    await handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, CONFIG)
    await setTelemetryEnabled(false)
    await handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, CONFIG)
    assert.equal(requests.length, 1)
    assert.deepEqual(await loadTelemetryConsent(), { enabled: false, distinctId: null })
  })
})

test("une panne réseau n'interrompt pas le produit et ne relance pas l'envoi", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    throw new Error("offline")
  }) as typeof fetch
  try {
    await assert.doesNotReject(handleTelemetryTrack({ name: "telemetry_enabled" }, CONFIG))
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("une panne du stockage de consentement ne provoque ni envoi ni rejet", async () => {
  fakeStorage()
  ;(globalThis as any).browser.storage.local.get = async () => { throw new Error("storage unavailable") }
  await withRequests(async (requests) => {
    await assert.doesNotReject(handleTelemetryTrack({ name: "telemetry_enabled" }, CONFIG))
    assert.deepEqual(requests, [])
  })
})

test("une identité non persistée n'est jamais envoyée", async () => {
  fakeStorage()
  ;(globalThis as any).browser.storage.local.set = async () => { throw new Error("storage unavailable") }
  await withRequests(async (requests) => {
    await assert.doesNotReject(handleTelemetryTrack({ name: "read_started", properties: { engine: "system" } }, CONFIG))
    assert.deepEqual(requests, [])
  })
})
