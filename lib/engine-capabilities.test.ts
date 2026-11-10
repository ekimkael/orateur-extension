import assert from "node:assert/strict"
import test from "node:test"
import { ENGINE_CAPABILITIES } from "./engine-capabilities.ts"

test("pronunciation stays available for existing engines only", () => {
  const supported = Object.entries(ENGINE_CAPABILITIES)
    .filter(([, capabilities]) => capabilities.pronunciation)
    .map(([engine]) => engine)
  assert.deepEqual(supported, ["system", "supertonic"])
})
