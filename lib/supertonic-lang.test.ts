import assert from "node:assert/strict"
import test from "node:test"
import { toSupertonicLang } from "./supertonic-lang.ts"

test("réduit une balise région à son code de langue", () => {
  assert.equal(toSupertonicLang("fr-FR"), "fr")
  assert.equal(toSupertonicLang("en-US"), "en")
})

test("normalise la casse", () => {
  assert.equal(toSupertonicLang("FR"), "fr")
  assert.equal(toSupertonicLang("Fr-fr"), "fr")
})

test("refuse une langue absente du modèle", () => {
  assert.equal(toSupertonicLang("zh-Hant"), null)
  assert.equal(toSupertonicLang("th"), null)
})

test("refuse une balise vide", () => {
  assert.equal(toSupertonicLang(""), null)
})

test("laisse passer le code particulier du modèle", () => {
  assert.equal(toSupertonicLang("na"), "na")
})
