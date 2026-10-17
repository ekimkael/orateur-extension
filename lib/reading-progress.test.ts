import assert from "node:assert/strict"
import test from "node:test"
import { clearReadingProgress, loadReadingProgress, pruneReadingProgress, READING_PROGRESS_KEY, READING_PROGRESS_MAX_AGE, saveReadingProgress } from "./reading-progress.ts"

function fakeStorage(privateWindow = false) {
  const data: Record<string, any> = {}
  let calls = 0
  ;(globalThis as any).browser = {
    extension: { inIncognitoContext: privateWindow },
    storage: { local: {
      get: async (key: string) => { calls++; return { [key]: data[key] } },
      set: async (entries: Record<string, unknown>) => { calls++; Object.assign(data, entries) },
    } },
  }
  return { data, calls: () => calls }
}
const now = Date.now()
const page = { url: "https://example.com/article?token=secret", title: "Private title", block: 3, total: 10, updatedAt: now }

test("progress resumes without storing raw URLs or titles", async () => {
  const { data } = fakeStorage()
  await saveReadingProgress(page)
  assert.deepEqual(await loadReadingProgress(page.url, 10, now), { ...page, title: "" })
  const encoded = JSON.stringify(data)
  assert.ok(!encoded.includes("secret"))
  assert.ok(!encoded.includes("Private title"))
  assert.ok(!encoded.includes("example.com"))
})
test("private windows do not read, write, or delete progress", async () => {
  const storage = fakeStorage(true)
  await saveReadingProgress(page)
  assert.equal(await loadReadingProgress(page.url, 10, now), null)
  await clearReadingProgress(page.url)
  await pruneReadingProgress(now)
  assert.equal(storage.calls(), 0)
})
test("query parameters identify different articles without persisting them", async () => {
  const { data } = fakeStorage()
  await saveReadingProgress(page)
  await saveReadingProgress({ ...page, url: page.url + "2", block: 5 })
  assert.equal(Object.keys(data[READING_PROGRESS_KEY]).length, 2)
  assert.equal((await loadReadingProgress(page.url, 10, now))?.block, 3)
})
test("cleanup removes legacy, expired, invalid, and future records", async () => {
  const { data } = fakeStorage()
  await saveReadingProgress(page)
  const store = data[READING_PROGRESS_KEY]
  store[page.url] = page
  const key = Object.keys(store)[0]
  store[key].updatedAt = now - READING_PROGRESS_MAX_AGE - 1
  await pruneReadingProgress(now)
  assert.deepEqual(data[READING_PROGRESS_KEY], {})
  await saveReadingProgress({ ...page, updatedAt: now + 1 })
  await pruneReadingProgress(now)
  assert.deepEqual(data[READING_PROGRESS_KEY], {})
})
test("changed paragraph counts and completion clear saved progress", async () => {
  const { data } = fakeStorage()
  await saveReadingProgress(page)
  assert.equal(await loadReadingProgress(page.url, 11, now), null)
  await saveReadingProgress(page)
  await clearReadingProgress(page.url)
  assert.deepEqual(data[READING_PROGRESS_KEY], {})
})
