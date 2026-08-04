import assert from "node:assert/strict"
import test from "node:test"
import { placeBubble } from "./bubble-position.ts"

const BUBBLE = { width: 80, height: 30 }
const VIEWPORT = { width: 1000, height: 800 }

test("se place au-dessus de la sélection et centrée", () => {
  const placed = placeBubble(
    { top: 400, left: 300, width: 200, height: 20 },
    BUBBLE,
    VIEWPORT
  )

  assert.equal(placed.top, 400 - 8 - BUBBLE.height)
  assert.equal(placed.left, 300 + 100 - BUBBLE.width / 2)
})

test("bascule dessous quand le haut manque de place", () => {
  const placed = placeBubble(
    { top: 4, left: 300, width: 200, height: 20 },
    BUBBLE,
    VIEWPORT
  )

  assert.equal(placed.top, 4 + 20 + 8)
})

test("se décale vers la droite plutôt que sortir par la gauche", () => {
  const placed = placeBubble(
    { top: 400, left: 0, width: 10, height: 20 },
    BUBBLE,
    VIEWPORT
  )

  assert.equal(placed.left, 8)
})

test("se décale vers la gauche plutôt que sortir par la droite", () => {
  const placed = placeBubble(
    { top: 400, left: 980, width: 20, height: 20 },
    BUBBLE,
    VIEWPORT
  )

  assert.equal(placed.left, VIEWPORT.width - BUBBLE.width - 8)
})

test("reste dans le viewport quand la sélection est tout en bas", () => {
  const placed = placeBubble(
    { top: 795, left: 300, width: 200, height: 20 },
    BUBBLE,
    VIEWPORT
  )

  assert.ok(placed.top + BUBBLE.height <= VIEWPORT.height - 8)
})

test("s'accroche au bord quand le viewport est plus petit que la bulle", () => {
  const placed = placeBubble(
    { top: 10, left: 5, width: 10, height: 10 },
    BUBBLE,
    { width: 40, height: 20 }
  )

  assert.deepEqual(placed, { top: 8, left: 8 })
})
