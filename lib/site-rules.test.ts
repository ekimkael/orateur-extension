import assert from "node:assert/strict"
import test from "node:test"
import { normalizeSite, isHidden, loadHiddenSites, addHiddenSite, removeHiddenSite } from "./site-rules.ts"

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

const KEY = "orateur:hidden-sites"

test("normalizeSite réduit une URL complète au domaine nu", () => {
  assert.equal(normalizeSite("https://www.youtube.com/watch?v=abc"), "youtube.com")
})

test("normalizeSite retire www. d'une saisie sans schéma", () => {
  assert.equal(normalizeSite("www.youtube.com"), "youtube.com")
})

test("normalizeSite laisse un domaine déjà propre inchangé", () => {
  assert.equal(normalizeSite("youtube.com"), "youtube.com")
})

test("normalizeSite rejette une saisie sans hôte valide", () => {
  assert.equal(normalizeSite("!!!"), null)
  assert.equal(normalizeSite(""), null)
  assert.equal(normalizeSite("   "), null)
})

test("isHidden matche le domaine exact", () => {
  assert.equal(isHidden("youtube.com", ["youtube.com"]), true)
})

test("isHidden matche un sous-domaine", () => {
  assert.equal(isHidden("m.youtube.com", ["youtube.com"]), true)
})

test("isHidden ne matche pas un domaine qui ne fait que se terminer pareil", () => {
  assert.equal(isHidden("notyoutube.com", ["youtube.com"]), false)
})

test("addHiddenSite ne duplique pas une entrée déjà présente", async () => {
  const data = fakeStorage({ [KEY]: ["youtube.com"] })
  await addHiddenSite("https://www.youtube.com/")
  assert.deepEqual(data[KEY], ["youtube.com"])
})

test("removeHiddenSite retire uniquement le domaine visé", async () => {
  const data = fakeStorage({ [KEY]: ["youtube.com", "example.com"] })
  await removeHiddenSite("youtube.com")
  assert.deepEqual(data[KEY], ["example.com"])
})

test("une valeur storage corrompue retombe sur une liste vide", async () => {
  fakeStorage({ [KEY]: "youtube.com" })
  assert.deepEqual(await loadHiddenSites(), [])
})
