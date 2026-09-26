import assert from "node:assert/strict"
import test from "node:test"
import { moveReadingBlock } from "./reading-navigation.ts"

test("début : précédent est désactivé, suivant avance", () => {
  assert.equal(moveReadingBlock(0, 3, -1), null)
  assert.equal(moveReadingBlock(0, 3, 1), 1)
})

test("milieu : précédent et suivant changent d'un paragraphe", () => {
  assert.equal(moveReadingBlock(2, 5, -1), 1)
  assert.equal(moveReadingBlock(2, 5, 1), 3)
})

test("fin : suivant est désactivé, précédent recule", () => {
  assert.equal(moveReadingBlock(2, 3, 1), null)
  assert.equal(moveReadingBlock(2, 3, -1), 1)
})
