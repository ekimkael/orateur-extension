import assert from "node:assert/strict"
import test from "node:test"
import { buildReadingOutro, nextCompletedCount, SUPPORT_CADENCE } from "./reading-outro.ts"

const FR_THANKS = "Fin de l'article, merci d'avoir écouté."
const FR_SUPPORT = "Orateur est développé par une seule personne. Si cette lecture vous a été utile, un petit don m'aide à continuer. Le lien est juste à côté."
const EN_THANKS = "End of the article, thank you for listening."
const EN_SUPPORT = "Orateur is built by one person. If this reading was useful, a small donation helps me keep going. The link is right there."

let stored: Record<string, unknown> = {}
let failing = false
;(globalThis as any).browser = {
  storage: {
    local: {
      get: async (key: string) => {
        if (failing) throw new Error("storage unavailable")
        return key in stored ? { [key]: stored[key] } : {}
      },
      set: async (items: Record<string, unknown>) => { Object.assign(stored, items) },
    },
  },
}

test("the first completed article thanks the listener and asks for support", () => {
  assert.deepEqual(buildReadingOutro("fr", 0), { speech: `${FR_THANKS} ${FR_SUPPORT}`, support: true })
})

test("between cadence points only the thanks is spoken", () => {
  assert.deepEqual(buildReadingOutro("fr", 1), { speech: FR_THANKS, support: false })
  assert.deepEqual(buildReadingOutro("en", 2), { speech: EN_THANKS, support: false })
})

test("the support ask comes back every cadence completions", () => {
  assert.equal(SUPPORT_CADENCE, 3)
  assert.deepEqual(buildReadingOutro("en", 3), { speech: `${EN_THANKS} ${EN_SUPPORT}`, support: true })
  assert.equal(buildReadingOutro("en", 6).support, true)
})

test("a reading in another language gets no spoken outro but keeps the cadence", () => {
  assert.deepEqual(buildReadingOutro("es", 0), { speech: "", support: true })
  assert.deepEqual(buildReadingOutro(null, 1), { speech: "", support: false })
})

test("the completion counter returns the count before this completion and advances", async () => {
  stored = {}
  failing = false
  assert.equal(await nextCompletedCount(), 0)
  assert.equal(await nextCompletedCount(), 1)
  assert.equal(stored["orateur:completed-articles"], 2)
})

test("unavailable storage counts as the first completion", async () => {
  failing = true
  assert.equal(await nextCompletedCount(), 0)
  failing = false
})
