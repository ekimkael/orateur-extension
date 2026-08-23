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
      sendMessage: async (message: unknown) => {
        sent.push(message)
      },
    },
  }
  return { data, sent }
}

const KEY = "orateur:telemetry"

test("désactivée par défaut, aucun identifiant tant que rien n'est stocké", async () => {
  fakeStorage()
  assert.deepEqual(await loadTelemetryConsent(), { enabled: false, distinctId: null })
})

test("activer crée un identifiant", async () => {
  const { data } = fakeStorage()
  await setTelemetryEnabled(true)
  const consent = await loadTelemetryConsent()
  assert.equal(consent.enabled, true)
  assert.equal(typeof consent.distinctId, "string")
  assert.ok(consent.distinctId!.length > 0)
  assert.deepEqual(data[KEY], consent)
})

test("désactiver efface l'identifiant, pas seulement le drapeau", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "déjà-là" } })
  await setTelemetryEnabled(false)
  assert.deepEqual(await loadTelemetryConsent(), { enabled: false, distinctId: null })
})

test("activer deux fois de suite garde le même identifiant, ne le régénère pas", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "stable-id" } })
  await setTelemetryEnabled(true)
  assert.equal((await loadTelemetryConsent()).distinctId, "stable-id")
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

test("handleTelemetryTrack() ne fait rien tant que la clé PostHog est le placeholder", async () => {
  fakeStorage({ [KEY]: { enabled: true, distinctId: "un-id" } })
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response(null, { status: 200 })
  }) as typeof fetch
  try {
    await handleTelemetryTrack({ name: "read_completed" })
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("handleTelemetryTrack() ne fait rien sans consentement, même avec un identifiant résiduel", async () => {
  fakeStorage({ [KEY]: { enabled: false, distinctId: null } })
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response(null, { status: 200 })
  }) as typeof fetch
  try {
    await handleTelemetryTrack({ name: "installed" })
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
