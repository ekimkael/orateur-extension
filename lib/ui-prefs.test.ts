import assert from "node:assert/strict"
import test from "node:test"
import { loadUiPrefs, saveUiPrefs } from "./ui-prefs.ts"

/** Storage local en mémoire — `browser` est un global fourni par WXT. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  ;(globalThis as any).browser = {
    storage: {
      local: {
        get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
        set: async (entries: Record<string, unknown>) => Object.assign(data, entries),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
  return data
}

const KEY = "orateur:ui-prefs"

test("part sur les défauts quand rien n'est stocké", async () => {
  fakeStorage()
  assert.deepEqual(await loadUiPrefs(), { theme: "system", language: "auto" })
})

test("complète une préférence partielle avec les défauts", async () => {
  fakeStorage({ [KEY]: { theme: "dark" } })

  const prefs = await loadUiPrefs()
  assert.equal(prefs.theme, "dark")
  assert.equal(prefs.language, "auto")
})

test("saveUiPrefs n'écrase que la clé fournie", async () => {
  const data = fakeStorage({ [KEY]: { theme: "dark", language: "fr" } })

  await saveUiPrefs({ theme: "light" })

  assert.deepEqual(data[KEY], { theme: "light", language: "fr" })
})

test("un thème inconnu venu du storage retombe sur le défaut", async () => {
  fakeStorage({ [KEY]: { theme: "solarized" } })
  assert.equal((await loadUiPrefs()).theme, "system")
})

test("une langue inconnue venue du storage retombe sur le défaut", async () => {
  fakeStorage({ [KEY]: { language: "de" } })
  assert.equal((await loadUiPrefs()).language, "auto")
})

test("deux écritures successives ne se perdent pas", async () => {
  const data = fakeStorage()

  await saveUiPrefs({ theme: "dark" })
  await saveUiPrefs({ language: "en" })

  assert.deepEqual(data[KEY], { theme: "dark", language: "en" })
})
