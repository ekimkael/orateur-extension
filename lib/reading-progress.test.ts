import assert from "node:assert/strict"
import test from "node:test"
import {
  clearReadingProgress,
  loadReadingProgress,
  READING_PROGRESS_KEY,
  READING_PROGRESS_MAX_AGE,
  saveReadingProgress,
} from "./reading-progress.ts"

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  ;(globalThis as any).browser = {
    storage: {
      local: {
        get: async (key: string) => key in data ? { [key]: data[key] } : {},
        set: async (entries: Record<string, unknown>) => Object.assign(data, entries),
      },
    },
  }
  return data
}

const now = 2_000_000_000_000
const page = {
  url: "https://example.com/article",
  title: "Article",
  block: 3,
  total: 10,
  updatedAt: now,
}

test("sérialise puis relit une progression valide", async () => {
  fakeStorage()
  await saveReadingProgress(page)
  assert.deepEqual(await loadReadingProgress(page.url, page.total, now), page)
})

test("supprime les entrées expirées et invalides", async () => {
  const data = fakeStorage({
    [READING_PROGRESS_KEY]: {
      expired: { ...page, url: "expired", updatedAt: now - READING_PROGRESS_MAX_AGE - 1 },
      invalid: { ...page, url: "invalid", block: 12 },
      [page.url]: page,
    },
  })
  assert.deepEqual(await loadReadingProgress(page.url, page.total, now), page)
  assert.deepEqual(data[READING_PROGRESS_KEY], { [page.url]: page })
})

test("invalide une progression quand le nombre de paragraphes change", async () => {
  const data = fakeStorage({ [READING_PROGRESS_KEY]: { [page.url]: page } })
  assert.equal(await loadReadingProgress(page.url, page.total + 1, now), null)
  assert.deepEqual(data[READING_PROGRESS_KEY], {})
})

test("un titre dynamique ne fait pas perdre la progression", async () => {
  const saved = { ...page, title: "Ancien titre dynamique" }
  fakeStorage({ [READING_PROGRESS_KEY]: { [page.url]: saved } })
  assert.deepEqual(await loadReadingProgress(page.url, page.total, now), saved)
})

test("efface la progression d'une lecture terminée", async () => {
  const data = fakeStorage({ [READING_PROGRESS_KEY]: { [page.url]: page } })
  await clearReadingProgress(page.url)
  assert.deepEqual(data[READING_PROGRESS_KEY], {})
})
