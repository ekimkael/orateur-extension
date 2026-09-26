export const READING_PROGRESS_KEY = "orateur:reading-progress"
export const READING_PROGRESS_MAX_AGE = 30 * 24 * 60 * 60 * 1000

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

export async function loadReadingProgress(url: string, total: number, now = Date.now()) {
  const data = await browser.storage.local.get(READING_PROGRESS_KEY)
  const raw = data[READING_PROGRESS_KEY]
  const hasObjectStore = !!raw && typeof raw === "object" && !Array.isArray(raw)
  const source = hasObjectStore ? raw as Record<string, unknown> : {}
  const valid: ProgressStore = {}

  for (const [key, value] of Object.entries(source)) {
    if (isProgress(value) && now - value.updatedAt <= READING_PROGRESS_MAX_AGE) valid[key] = value
  }

  const progress = valid[url]
  const incompatible = !!progress && progress.total !== total
  if (incompatible) delete valid[url]
  if ((raw !== undefined && !hasObjectStore) || Object.keys(valid).length !== Object.keys(source).length || incompatible) {
    await browser.storage.local.set({ [READING_PROGRESS_KEY]: valid })
  }
  return progress && !incompatible ? progress : null
}

export async function saveReadingProgress(progress: ReadingProgress) {
  if (!isProgress(progress)) return
  const data = await browser.storage.local.get(READING_PROGRESS_KEY)
  const raw = data[READING_PROGRESS_KEY]
  const store = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as ProgressStore : {}
  await browser.storage.local.set({ [READING_PROGRESS_KEY]: { ...store, [progress.url]: progress } })
}

export async function clearReadingProgress(url: string) {
  const data = await browser.storage.local.get(READING_PROGRESS_KEY)
  const raw = data[READING_PROGRESS_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return
  const store = { ...raw as ProgressStore }
  if (!(url in store)) return
  delete store[url]
  await browser.storage.local.set({ [READING_PROGRESS_KEY]: store })
}
