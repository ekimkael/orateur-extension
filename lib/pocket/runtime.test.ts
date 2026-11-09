import assert from "node:assert/strict"
import test from "node:test"
import { eitherSignal } from "./runtime.ts"

test("eitherSignal aborts with whichever source aborts first, without AbortSignal.any", () => {
  const any = AbortSignal.any
  try {
    // Chrome before 116 and Firefox before 124 have no AbortSignal.any.
    Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true })
    const reading = new AbortController()
    const lifetime = new AbortController()
    const { signal } = eitherSignal(reading.signal, lifetime.signal)
    assert.equal(signal.aborted, false)
    lifetime.abort("disposed")
    assert.equal(signal.aborted, true)
    assert.equal(signal.reason, "disposed")

    const aborted = new AbortController()
    aborted.abort("seek")
    assert.equal(eitherSignal(aborted.signal, new AbortController().signal).signal.reason, "seek")
  } finally {
    Object.defineProperty(AbortSignal, "any", { value: any, configurable: true })
  }
})

test("eitherSignal stops listening once released, so the host's lifetime signal does not collect listeners", () => {
  const lifetime = new AbortController()
  const { signal, release } = eitherSignal(new AbortController().signal, lifetime.signal)
  release()
  lifetime.abort()
  assert.equal(signal.aborted, false)
})
