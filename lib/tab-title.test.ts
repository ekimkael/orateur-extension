import assert from "node:assert/strict"
import test from "node:test"
import { MARK, withMark, withoutMark } from "./tab-title.ts"

test("préfixe un titre qui ne l'est pas encore", () => {
  assert.equal(withMark("Le titre"), `${MARK}Le titre`)
})

test("ne double pas le préfixe", () => {
  assert.equal(withMark(`${MARK}Le titre`), `${MARK}Le titre`)
})

test("retire le préfixe", () => {
  assert.equal(withoutMark(`${MARK}Le titre`), "Le titre")
})

test("un titre non préfixé traverse withoutMark sans y toucher", () => {
  assert.equal(withoutMark("Le titre"), "Le titre")
})

test("suit un titre que la page a changé pendant la lecture", () => {
  assert.equal(withoutMark(`${MARK}Nouveau titre`), "Nouveau titre")
})

test("titre vide dans les deux sens", () => {
  assert.equal(withMark(""), MARK)
  assert.equal(withoutMark(""), "")
})
