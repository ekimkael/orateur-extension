import assert from "node:assert/strict"
import test from "node:test"
import { buildReadingIntro } from "./reading-intro.ts"

test("annonce le titre dans la langue de l'article", () => {
  assert.equal(buildReadingIntro("fr", "Le titre"), "Au programme : Le titre.")
  assert.equal(buildReadingIntro("en", "The title"), "Coming up: The title.")
})

test("ne redouble pas la ponctuation d'un titre déjà ponctué", () => {
  assert.equal(buildReadingIntro("fr", "Vraiment ?"), "Au programme : Vraiment ?")
  // Un guillemet fermant referme une phrase qui porte déjà sa ponctuation.
  assert.equal(buildReadingIntro("fr", "« Écoutez ! »"), "Au programme : « Écoutez ! »")
})

test("retombe sur le français : code long, langue inconnue ou absente", () => {
  assert.equal(buildReadingIntro("en-US", "T"), "Coming up: T.")
  assert.equal(buildReadingIntro("zz", "T"), "Au programme : T.")
  assert.equal(buildReadingIntro("", "T"), "Au programme : T.")
})

test("pas de titre, pas d'annonce", () => {
  assert.equal(buildReadingIntro("fr", "   "), "")
})
