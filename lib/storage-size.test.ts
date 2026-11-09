import assert from "node:assert/strict"
import test from "node:test"
import { toMegabytes } from "./storage-size.ts"

test("model sizes use one megabyte, the 1024² of the download progress", () => {
  // Pocket's French model and voice weigh about 142,000,000 bytes: its cache
  // line used to say 142 MB while the same bytes downloaded as 135 MB.
  assert.equal(toMegabytes(142_000_000), 135)
  assert.equal(toMegabytes(1024 * 1024), 1)
})
