export const READING_PROGRESS_KEY = "orateur:reading-progress"
export const READING_PROGRESS_MAX_AGE = 30 * 24 * 60 * 60 * 1000
export const READING_PROGRESS_ALARM = "orateur:expire-reading-progress"

export interface ReadingProgress {
  url: string
  title: string
  block: number
  total: number
  updatedAt: number
}

type ProgressStore = Record<string, ReadingProgress>

function isProgress(value: unknown): value is ReadingProgress {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<ReadingProgress>
  return (
    typeof item.url === "string" &&
    typeof item.title === "string" &&
    Number.isInteger(item.block) &&
    Number.isInteger(item.total) &&
    typeof item.updatedAt === "number" &&
    Number.isFinite(item.updatedAt) &&
    item.block! >= 0 &&
    item.total! > 0 &&
    item.block! < item.total!
  )
}

function isPrivate() {
  return browser.extension?.inIncognitoContext === true
}

async function progressKey(url: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

async function validStore(now: number): Promise<ProgressStore> {
  const data = await browser.storage.local.get(READING_PROGRESS_KEY)
  const raw = data[READING_PROGRESS_KEY]
  const store: ProgressStore = {}
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, item] of Object.entries(raw)) {
      if (/^sha256:[a-f0-9]{64}$/.test(key) && isProgress(item) && item.url === key && item.title === "" &&
          item.updatedAt <= now && now - item.updatedAt <= READING_PROGRESS_MAX_AGE) store[key] = item
    }
  }
  return store
}

export async function pruneReadingProgress(now = Date.now()) {
  if (isPrivate()) return
  await browser.storage.local.set({ [READING_PROGRESS_KEY]: await validStore(now) })
}

export async function loadReadingProgress(url: string, total: number, now = Date.now()) {
  if (isPrivate()) return null
  const key = await progressKey(url)
  const store = await validStore(now)
  const progress = store[key]
  if (progress && progress.total !== total) delete store[key]
  await browser.storage.local.set({ [READING_PROGRESS_KEY]: store })
  return progress && progress.total === total ? { ...progress, url } : null
}

export async function saveReadingProgress(progress: ReadingProgress) {
  if (isPrivate() || !isProgress(progress)) return
  const key = await progressKey(progress.url)
  const store = await validStore(progress.updatedAt)
  store[key] = { ...progress, url: key, title: "" }
  await browser.storage.local.set({ [READING_PROGRESS_KEY]: store })
}

export async function clearReadingProgress(url: string) {
  if (isPrivate()) return
  const key = await progressKey(url)
  const store = await validStore(Date.now())
  delete store[key]
  await browser.storage.local.set({ [READING_PROGRESS_KEY]: store })
}
