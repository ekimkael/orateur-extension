import assert from "node:assert/strict"
import test from "node:test"
import { expandText } from "./pronunciation/index.ts"

/**
 * `lib/pronunciation/` est une copie **au caractère près** de
 * `mobile/lib/pronunciation/` — style d'écriture et commentaires anglais
 * compris. C'est délibéré : tant que les deux dossiers sont identiques,
 * `diff -r ../mobile/lib/pronunciation lib/pronunciation` suffit à voir la
 * dérive. Une règle corrigée d'un côté se recopie de l'autre.
 *
 * Ces cas viennent de `mobile/lib/pronunciation.check.ts`, réécrits en
 * `node:test` (l'extension n'a pas de lanceur maison).
 */

const FR = "Le backlog du sprint : 30 % des features sont en frontend — vs. 10+ tickets côté API."

test("voix système française : les trois couches s'appliquent", () => {
  assert.equal(
    expandText(FR, { language: "fr" }),
    "Le baquelog du sprinte, 30 pourcent des fîtcheurs sont en frontènde, versus 10 ou plus tickets côté A P I."
  )
})

test("moteur neuronal : la ponctuation et la verbalisation restent", () => {
  assert.equal(
    expandText(FR, { language: "fr", skipPhonetic: true }),
    "Le backlog du sprint, 30 pourcent des features sont en frontend, versus 10 ou plus tickets côté API."
  )
})

test("l'anglais verbalise en anglais, sans couche phonétique", () => {
  assert.equal(
    expandText("The 1st release: 30 % faster — see e.g. 10+ APIs.", { language: "en" }),
    "The first release, 30 percent faster, see for example, 10 or more A P I s."
  )
})

test("langue sans fichier : ponctuation seule, pas de repli sur le français", () => {
  assert.equal(expandText("Der Sprint: 30 % — API", { language: "de" }), "Der Sprint, 30 %, A P I")
})

test("épelle les sigles, laisse les mots criés", () => {
  assert.equal(
    expandText("API SDK B2B HTML JSON STOP ATTENTION OK 2024 SaaS", { language: "fr" }),
    "A P I S D K B 2 B H T M L J S O N Stop Attention OK 2024 saas"
  )
  assert.equal(expandText("via une API REST", { language: "fr-FR" }), "via une A P I Rest")
  assert.equal(expandText("NON, ce n'est PAS un bug", { language: "fr" }), "NON, ce n'est PAS un beug")
})

test("le moteur neuronal reçoit le sigle brut, capitales comprises", () => {
  assert.equal(expandText("une API", { language: "fr", skipPhonetic: true }), "une API")
  assert.equal(expandText("du JSON en HTML", { language: "fr", skipPhonetic: true }), "du JSON en HTML")
})

test("deux-points : pause sur la prose, intact sur les heures et les URL", () => {
  assert.equal(expandText("Titre : sous-titre", { language: "fr" }), "Titre, sous-titre")
  assert.equal(expandText("14:30 et 3:1", { language: "fr" }), "14:30 et 3:1")
  assert.equal(expandText("https://exemple.fr", { language: "fr" }), "https://exemple.fr")
})

test("aucun mot français n'est réécrit", () => {
  assert.equal(expandText("un agent immobilier", { language: "fr" }), "un agent immobilier")
  assert.equal(expandText("3 m. de câble", { language: "fr" }), "3 m. de câble")
  assert.equal(expandText("Un Drone rapide", { language: "fr" }), "Un Drone rapide")
  assert.equal(
    expandText("Dr Dupont et Mme Martin", { language: "fr" }),
    "Docteur Dupont et Madame Martin"
  )
})

test("langue absente : le français, comme partout ailleurs", () => {
  assert.equal(expandText("un backlog"), "un baquelog")
  assert.equal(expandText("The backlog", { language: "en" }), "The backlog")
})

test("relire un texte déjà parlé ne le dégrade pas", () => {
  for (const language of ["fr", "en", "de"]) {
    const once = expandText(FR, { language })
    assert.equal(expandText(once, { language }), once)
  }
})
