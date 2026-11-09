import assert from "node:assert/strict"
import test from "node:test"
import { loadPrefs, savePrefs, seedEngine, SPEED } from "./reader-prefs.ts"

/** Storage local en mémoire — `browser` est un global fourni par WXT. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  ;(globalThis as any).browser = {
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
        set: async (entries: Record<string, unknown>) => Object.assign(data, entries),
      },
    },
  }
  return data
}

const KEY = "orateur:reader-prefs"

test("part sur les défauts quand rien n'est stocké", async () => {
  fakeStorage()
  assert.deepEqual(await loadPrefs(), {
    engine: "supertonic",
    speed: 1,
    voiceURI: null,
    supertonicVoice: "F1",
    pocketVoice: "auto",
    follow: true,
    position: "bottom-right",
  })
})

test("complète une préférence partielle avec les défauts", async () => {
  fakeStorage({ [KEY]: { speed: 1.5 } })

  const prefs = await loadPrefs()
  assert.equal(prefs.speed, 1.5)
  assert.equal(prefs.engine, "supertonic")
  assert.equal(prefs.voiceURI, null)
})

test("savePrefs n'écrase que la clé fournie", async () => {
  const data = fakeStorage({ [KEY]: { speed: 1.5, voiceURI: "urn:voix" } })

  await savePrefs({ speed: 0.8 })

  assert.deepEqual(data[KEY], {
    engine: "supertonic",
    speed: 0.8,
    voiceURI: "urn:voix",
    supertonicVoice: "F1",
    pocketVoice: "auto",
    follow: true,
    position: "bottom-right",
  })
})

test("ramène une vitesse hors bornes dans la plage", async () => {
  fakeStorage({ [KEY]: { speed: 12 } })
  assert.equal((await loadPrefs()).speed, SPEED.max)

  fakeStorage({ [KEY]: { speed: 0.1 } })
  assert.equal((await loadPrefs()).speed, SPEED.min)
})

test("supertonicVoice a son propre défaut, indépendant de voiceURI", async () => {
  fakeStorage({ [KEY]: { voiceURI: "urn:voix-systeme" } })
  const prefs = await loadPrefs()
  assert.equal(prefs.voiceURI, "urn:voix-systeme")
  assert.equal(prefs.supertonicVoice, "F1")
})

test("ignore une vitesse qui n'est pas un nombre", async () => {
  fakeStorage({ [KEY]: { speed: "rapide" } })
  assert.equal((await loadPrefs()).speed, 1)

  fakeStorage({ [KEY]: { speed: NaN } })
  assert.equal((await loadPrefs()).speed, 1)
})

test("deux écritures successives ne se perdent pas", async () => {
  const data = fakeStorage()

  await savePrefs({ speed: 1.2 })
  await savePrefs({ voiceURI: "urn:voix" })

  assert.deepEqual(data[KEY], {
    engine: "supertonic",
    speed: 1.2,
    voiceURI: "urn:voix",
    supertonicVoice: "F1",
    pocketVoice: "auto",
    follow: true,
    position: "bottom-right",
  })
})

test("seedEngine never overrides a stored engine", async () => {
  fakeStorage()
  await seedEngine("pocket")
  assert.equal((await loadPrefs()).engine, "pocket")
  await seedEngine("system")
  assert.equal((await loadPrefs()).engine, "pocket")

  fakeStorage({ [KEY]: { speed: 1.2 } })
  await seedEngine("system")
  assert.equal((await loadPrefs()).engine, "system")

  fakeStorage({ [KEY]: { engine: "supertonic" } })
  await seedEngine("system")
  assert.equal((await loadPrefs()).engine, "supertonic")
})

test("Pocket has its own voice and preserves the voices stored by older versions", async () => {
  fakeStorage({ [KEY]: { engine: "supertonic", supertonicVoice: "F2", voiceURI: "urn:voice" } })

  await savePrefs({ engine: "pocket", pocketVoice: "estelle" })
  await savePrefs({ engine: "system" })
  await savePrefs({ engine: "supertonic" })

  const prefs = await loadPrefs()
  assert.equal(prefs.pocketVoice, "estelle")
  assert.equal(prefs.supertonicVoice, "F2")
  assert.equal(prefs.voiceURI, "urn:voice")
})

test("choosing a Pocket voice while the engine choice is being saved keeps both settings", async () => {
  fakeStorage({ [KEY]: { engine: "system", voiceURI: "urn:voice" } })

  await Promise.all([savePrefs({ engine: "pocket" }), savePrefs({ pocketVoice: "estelle" })])

  const prefs = await loadPrefs()
  assert.equal(prefs.engine, "pocket")
  assert.equal(prefs.pocketVoice, "estelle")
  assert.equal(prefs.voiceURI, "urn:voice")
})

test("unknown stored engine and Pocket voice resolve to safe choices", async () => {
  fakeStorage({ [KEY]: { engine: "constructor", pocketVoice: "custom-url" } })
  const prefs = await loadPrefs()
  assert.equal(prefs.engine, "system")
  assert.equal(prefs.pocketVoice, "auto")
})

test("an unknown stored Supertonic voice resolves to the default one", async () => {
  // The TTS host refuses an unknown voice: passing it on would fail every reading.
  fakeStorage({ [KEY]: { engine: "supertonic", supertonicVoice: "Z9" } })
  assert.equal((await loadPrefs()).supertonicVoice, "F1")
})
