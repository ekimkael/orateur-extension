import assert from "node:assert/strict"
import test from "node:test"
import { loadPrefs, savePrefs, SPEED } from "./reader-prefs.ts"

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
    engine: "system",
    speed: 1,
    voiceURI: null,
    supertonicVoice: "F1",
    follow: true,
  })
})

test("complète une préférence partielle avec les défauts", async () => {
  fakeStorage({ [KEY]: { speed: 1.5 } })

  const prefs = await loadPrefs()
  assert.equal(prefs.speed, 1.5)
  assert.equal(prefs.engine, "system")
  assert.equal(prefs.voiceURI, null)
})

test("savePrefs n'écrase que la clé fournie", async () => {
  const data = fakeStorage({ [KEY]: { speed: 1.5, voiceURI: "urn:voix" } })

  await savePrefs({ speed: 0.8 })

  assert.deepEqual(data[KEY], {
    engine: "system",
    speed: 0.8,
    voiceURI: "urn:voix",
    supertonicVoice: "F1",
    follow: true,
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
    engine: "system",
    speed: 1.2,
    voiceURI: "urn:voix",
    supertonicVoice: "F1",
    follow: true,
  })
})
