import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import * as messages from "./tts-messages.ts"
import { isModelCached } from "./supertonic/model-cache.ts"
import { ONNX_FILES, SUPERTONIC_VOICES } from "./supertonic/types.ts"

type Listener = (message: { type: string }, sender: { tab: { id: number } }, respond: (cached: boolean) => void) => unknown

let cleanupCalls = 0
let alarmListeners: ((alarm: { name: string }) => void)[] = []
let scheduledAlarms: { name: string; periodInMinutes: number }[] = []

function backgroundListeners(firefox: boolean): Listener[] {
  cleanupCalls = 0
  alarmListeners = []
  scheduledAlarms = []
  const listeners: Listener[] = []
  const event = { addListener() {} }
  const browser = {
    runtime: { onMessage: { addListener: (listener: Listener) => listeners.push(listener) }, onInstalled: event },
    contextMenus: { onClicked: event },
    storage: { onChanged: event },
    alarms: {
      create: (name: string, options: { periodInMinutes: number }) => scheduledAlarms.push({ name, ...options }),
      onAlarm: { addListener: (listener: (alarm: { name: string }) => void) => alarmListeners.push(listener) },
    },
    tabs: { onRemoved: event },
    action: { onClicked: event },
  }
  // Exercise the actual WXT background entrypoint, replacing only its build-time flag and unrelated imports.
  const source = readFileSync(new URL("../entrypoints/background.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env.FIREFOX", String(firefox))
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports: { default?: { main(): void } } = {}
  vm.runInNewContext(outputText, {
    exports,
    browser,
    defineBackground: (configuration: unknown) => configuration,
    require: (name: string) => {
      if (name === "../lib/reading-progress.ts") return {
        READING_PROGRESS_ALARM: "orateur:expire-reading-progress",
        pruneReadingProgress: async () => { cleanupCalls++ },
      }
      if (name === "../lib/tts-messages") return messages
      if (name === "../lib/supertonic/model-cache") return { isModelCached }
      return {}
    },
  })
  exports.default!.main()
  return listeners
}

for (const firefox of [false, true]) {
  test(`MODEL_CACHE_QUERY reads extension cache without starting a host (${firefox ? "Firefox" : "Chrome"})`, async () => {
    const listeners = backgroundListeners(firefox)
    const files = new Set<string>()
    const originalStorage = (navigator as any).storage
    ;(navigator as any).storage = {
      getDirectory: async () => ({
        getDirectoryHandle: async () => ({
          getFileHandle: async (name: string) => {
            if (!files.has(name)) throw new DOMException("Not found", "NotFoundError")
            return {}
          },
        }),
      }),
    }
    const query = () => new Promise<boolean>((resolve) => {
      let responders = 0
      for (const listener of listeners) {
        if (listener({ type: messages.MODEL_CACHE_QUERY }, { tab: { id: 7 } }, resolve) === true) responders++
      }
      assert.equal(responders, 1, "only the background cache query keeps the response channel open")
    })
    try {
      assert.equal(await query(), false, "empty cache requires a download")
      for (const { name } of ONNX_FILES) files.add(name)
      for (const voice of SUPERTONIC_VOICES) files.add(`voice-${voice}.json`)
      assert.equal(await query(), true, "all model and voice files are ready")
      files.delete("voice-F1.json")
      assert.equal(await query(), false, "cache changes are read on each query")
      ;(navigator as any).storage.getDirectory = async () => { throw new Error("Unavailable") }
      assert.equal(await query(), false, "unavailable storage responds without leaving the request pending")
    } finally {
      ;(navigator as any).storage = originalStorage
    }
  })
}


test("progress cleanup runs on startup and on its hourly alarm", () => {
  backgroundListeners(true)
  assert.equal(cleanupCalls, 1)
  assert.deepEqual(scheduledAlarms, [{ name: "orateur:expire-reading-progress", periodInMinutes: 60 }])
  alarmListeners[0]({ name: "other-alarm" })
  assert.equal(cleanupCalls, 1)
  alarmListeners[0]({ name: "orateur:expire-reading-progress" })
  assert.equal(cleanupCalls, 2)
})
