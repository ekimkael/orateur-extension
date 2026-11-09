import assert from "node:assert/strict"
import test from "node:test"
import { createMessageRouter } from "./background-router.ts"

type Message = { type: "sync"; value: number } | { type: "async" } | { type: "silent" } | { type: "elsewhere" }

/** Dispatches one message the way `runtime.onMessage` would, and records the answers. */
function dispatch(listener: ReturnType<typeof createMessageRouter<Message>>, message: unknown) {
  const answers: unknown[] = []
  const kept = listener(message, {}, (answer) => answers.push(answer))
  return { kept, answers }
}

const router = createMessageRouter<Message>({
  sync: (message) => (message.value ?? 0) + 1,
  async: async () => "later",
  silent: () => undefined,
  // The offscreen document answers this one itself when it exists.
  elsewhere: async () => undefined,
})

test("a synchronous answer is sent at once, without keeping the channel open", () => {
  assert.deepEqual(dispatch(router, { type: "sync", value: 1 }), { kept: undefined, answers: [2] })
})

test("an asynchronous answer keeps the channel open and is sent once", async () => {
  const { kept, answers } = dispatch(router, { type: "async" })
  assert.equal(kept, true)
  await new Promise((resolve) => setTimeout(resolve))
  assert.deepEqual(answers, ["later"])
})

test("a handler that gives nothing leaves the answer to another context", async () => {
  assert.deepEqual(dispatch(router, { type: "silent" }), { kept: undefined, answers: [] })
  const { answers } = dispatch(router, { type: "elsewhere" })
  await new Promise((resolve) => setTimeout(resolve))
  assert.deepEqual(answers, [])
})

test("messages without a known type are not handled", () => {
  for (const message of [undefined, null, "sync", {}, { type: 1 }, { type: "unknown" }, { type: "toString" }]) {
    assert.deepEqual(dispatch(router, message), { kept: undefined, answers: [] })
  }
})

test("a failed asynchronous handler sends nothing", async () => {
  const failing = createMessageRouter<{ type: "boom" }>({ boom: async () => { throw new Error("boom") } })
  const { kept, answers } = dispatch(failing, { type: "boom" })
  assert.equal(kept, true)
  await new Promise((resolve) => setTimeout(resolve))
  assert.deepEqual(answers, [])
})
