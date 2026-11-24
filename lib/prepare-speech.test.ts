import assert from "node:assert/strict"
import test from "node:test"
import { Verbalizer } from "verbalis"
import { createSpeechPreparation, prepareSpeech } from "./prepare-speech.ts"

test("verbalizes French dates, units, money and zero-padded codes", () => {
  assert.equal(prepareSpeech("Le 14/07 à 20h30, 2 kg coûtent 20 €.", "fr-FR"),
    "Le quatorze juillet à vingt heures trente, deux kilogrammes coûtent vingt euros.")
  assert.equal(prepareSpeech("007 et 40\u202f000", "fr"), "zéro zéro sept et quarante mille")
})

test("skips emoji sequences before normalization and keeps surrounding text legible", () => {
  assert.equal(prepareSpeech("À 20H 🎉🇨🇲 👍🏾 🧑🏽‍💻 🏳‍🌈 1⃣ 2️⃣.", "fr"), "À vingt heures.")
  assert.equal(prepareSpeech("Hello🎉🌟there! ⚠️", "en"), "Hello there!")
  assert.equal(prepareSpeech(" 🎉🇫🇷  ", "fr"), "")
  assert.equal(prepareSpeech("🎉 🇨🇲.", "fr"), "", "Extraction adds a stop to paragraphs without one")
  assert.equal(prepareSpeech(" 🎉🇫🇷  ", "ru"), "")
  assert.equal(prepareSpeech("Добрый👍🏼день. © ™ ↔ 20°C", "ru"), "Добрый день. © ™ ↔ 20°C")
  assert.equal(prepareSpeech("20 °C, 5 % et 2 €.", "fr"), "vingt degrés Celsius, cinq pour cent et deux euros.")
  const rules = [{ id: "cheers", language: "fr", source: "Bravo", replacement: "Hourra 🎉", caseSensitive: true }] as const
  assert.equal(prepareSpeech("Bravo !", "fr", rules), "Hourra !")
  assert.equal(prepareSpeech("Bravo", "fr", [{ ...rules[0], replacement: "🎉" }]), "")
  assert.equal(prepareSpeech("Bravo 🎉!", "fr", [{ ...rules[0], replacement: "Hourra" }]), "Hourra !")
})

test("reads French hours and durations written with uppercase H", () => {
  assert.equal(prepareSpeech("À 6H45, à 8H30 et à 12H00.", "fr-CA"),
    "À six heures quarante-cinq, à huit heures trente et à douze heures.")
  assert.equal(prepareSpeech("Il reste 48H et le rendez-vous dure 2H15.", "fr"),
    "Il reste quarante-huit heures et le rendez-vous dure deux heures quinze.")
})

test("reads midnight and its minutes in French clock times", () => {
  assert.equal(prepareSpeech("Il avait travaillé jusqu'à 00H30 la veille.", "fr"),
    "Il avait travaillé jusqu'à minuit trente la veille.")
  assert.equal(prepareSpeech("À 0h, dès 00 h 15, vers 00:45. Il est 00:00.", "fr-CA"),
    "À minuit, dès minuit quinze, vers minuit quarante-cinq. Il est minuit.")
  assert.equal(prepareSpeech("Ouverture à 00h05 UTC. Réveil à 00H00.", "fr"),
    "Ouverture à minuit cinq UTC. Réveil à minuit.")
  assert.equal(prepareSpeech("Horaire : 00h30.", "fr"), "Horaire : minuit trente.")
})

test("leaves durations, timecodes and units to Verbalis", () => {
  const verbalizer = new Verbalizer("fr", { trim: false })
  for (const text of [
    "Il reste 0h30. Le chronomètre est réglé à 00:30.",
    "La durée est ramenée à 0 h 30.",
    "Les délais sont ramenés à 0 h 30.",
    "Voir le passage à 00:30:12.",
    "Une bobine de 0 H. Voir https://example.com/?t=00:30.",
  ]) assert.equal(prepareSpeech(text, "fr"), verbalizer.process(text), text)
})

test("reads uptime expressions even next to quotation marks", () => {
  assert.equal(prepareSpeech('Disponible “24H/24” et “7J/7”.', "fr"),
    'Disponible "vingt-quatre heures sur vingt-quatre" et "sept jours sur sept".')
  assert.equal(prepareSpeech("Disponible 24h/24 et 7j/7.", "fr"),
    "Disponible vingt-quatre heures sur vingt-quatre et sept jours sur sept.")
})

test("reads prefixed versions with dots instead of as decimals", () => {
  assert.equal(prepareSpeech("Version concernée : v2.3.1.", "fr"), "Version concernée : v deux point trois point un.")
  assert.equal(prepareSpeech("Orateur v2.3.1-beta.4.", "fr"), "Orateur v deux point trois point un beta quatre.")
})

test("reads labeled French versions with point and ordinary decimals with virgule", () => {
  assert.equal(prepareSpeech("OAuth 2.0, version 04.01 et pH 7.4.", "fr"),
    "OAuth deux point zéro, version zéro quatre point zéro un et pH sept virgule quatre.")
})

test("reads Roman numerals in French section references", () => {
  assert.equal(prepareSpeech("Henri IV, la section IV, la section XII et la section C.", "fr"),
    "Henri quatre, la section quatre, la section douze et la section C.")
  assert.equal(prepareSpeech("La section IVX et le code IV_2.", "fr"),
    "La section IVX et le code IV_ deux.")
})

test("dictates grouped international telephone numbers and preserves signed quantities", () => {
  assert.equal(prepareSpeech("Appelez le +237 699 12 34 56 entre 8H et 18H.", "fr"),
    "Appelez le plus deux trois sept, six neuf neuf, douze, trente-quatre, cinquante-six entre huit heures et dix-huit heures.")
  assert.equal(prepareSpeech("Tél. : +237 699 003 056.", "fr"),
    "téléphone : plus deux trois sept, six neuf neuf, zéro zéro trois, zéro cinq six.")
  const amount = "Une hausse de +1 234 567 890 FCFA."
  assert.equal(prepareSpeech(amount, "fr"), new Verbalizer("fr").process(amount.replace("FCFA", "francs CFA")))
})

test("reads FCFA as francs CFA in French speech", () => {
  assert.equal(prepareSpeech("FCFA", "fr"), "franc CFA")
  assert.equal(prepareSpeech("1 FCFA, 1,50 FCFA et 500FCFA.", "fr"),
    "un franc CFA, un virgule cinquante franc CFA et cinq cents francs CFA.")
  const identifiers = "Le code X_FCFA, la référence FCFA_2 et https://example.org/FCFA."
  assert.equal(prepareSpeech(identifiers, "fr"), new Verbalizer("fr").process(identifiers))
})

test("reads French ticket numbers and displayed statuses without changing standalone identifiers", () => {
  assert.equal(prepareSpeech("Ticket #04821 — Statut : EN_ATTENTE.", "fr"),
    "Ticket numéro zéro quatre huit deux un - Statut : en attente.")
  assert.equal(prepareSpeech("Le code EN_ATTENTE et #4821.", "fr"),
    "Le code EN_ATTENTE et hashtag quatre mille huit cent vingt et un.")
})

test("reads battery capacity, connection speed and division in French", () => {
  assert.equal(prepareSpeech("Une batterie de 5\u202f000 mAh, une ligne à 100 Mb/s et 15÷5.", "fr"),
    "Une batterie de cinq mille milliampères-heures, une ligne à cent mégabits par seconde et quinze divisé par cinq.")
  assert.equal(prepareSpeech("1 mAh, 0,5 Mb/s et 10 MB/s.", "fr"),
    "un milliampère-heure, zéro virgule cinq mégabit par seconde et dix MB/s.")
})

test("names standalone Greek letters in French while preserving unit and formula notation", () => {
  assert.equal(prepareSpeech("Il trouve également les symboles suivants : π, μ, Ω, Δ et °.", "fr"),
    "Il trouve également les symboles suivants : pi, mu, oméga, delta et degrés.")
  const notation = "La résistance est de 10 Ω, la masse de 5 μg et l'écart ΔT de 20 °C."
  assert.equal(prepareSpeech(notation, "fr"), new Verbalizer("fr", { trim: false }).process(notation))
})

test("reads English Greek letters, delta T and the requested scientific units", () => {
  for (const lang of ["en", "en-US", "en-GB"]) {
    assert.equal(prepareSpeech("He also finds the symbols π, μ, Ω, Δ, and °.", lang),
      "He also finds the symbols pi, mu, omega, delta, and degrees.")
    assert.equal(prepareSpeech("Some symbols have a familiar name. Others change meaning depending on where they appear, as with ΔT, 10 Ω, and 5 μg.", lang),
      "Some symbols have a familiar name. Others change meaning depending on where they appear, as with delta T, ten ohms, and five micrograms.")
  }
})

test("reads English unit agreement and leaves scientific identifiers and addresses to Verbalis", () => {
  assert.equal(prepareSpeech("Use 1Ω, 1 µg, 0.5 μg, and 1,000 Ω at 20°C.", "en-US"),
    "Use one ohm, one microgram, zero point five micrograms, and one thousand ohms at twenty degrees Celsius.")
  const literal = "Visit https://example.com/ΔT and contact μ@example.com. See Ω_ref."
  assert.equal(prepareSpeech(literal, "en-US"), new Verbalizer("en-us", { trim: false }).process(literal))
})

test("leaves nearby scientific notation, addresses and identifiers to Verbalis", () => {
  const verbalizer = new Verbalizer("fr", { trim: false })
  for (const text of [
    "Bobine de 7 H. IP 192.168.1.20.",
    "Voir https://example.com/v2.3.1?at=6H45.",
    "Contact v2.3.1@example.com et référence ID-6H45.",
    "Adresse v2.3.1.4, fichier v2.3.1.js et code 8H300.",
    "Voir https://example.com/section/IV.txt et l’état EN_ATTENTE_D_APPROBATION.",
    "Références ID-version 1.0, ID-10mAh et 100 MB/s.",
  ]) assert.equal(prepareSpeech(text, "fr"), verbalizer.process(text))
})

test("personal rules still match the original French hour and protect its replacement", () => {
  const rules = [{ id: "hour", language: "fr", source: "6H45", replacement: "8H30", caseSensitive: true }] as const
  assert.equal(prepareSpeech("6H45 puis 8H30.", "fr", rules), "8H30 puis huit heures trente.")
})

test("uses the declared language and preserves ambiguous slash dates without a reliable US region", () => {
  assert.equal(prepareSpeech("On 01/02/2024, I paid $5.", "en-US"), "On January second twenty twenty-four, I paid five dollars.")
  for (const lang of ["en", "en-GB"]) {
    assert.equal(prepareSpeech("On 01/02/2024, I paid £5.", lang), "On 01/02/2024, I paid five pounds.")
  }
  assert.equal(prepareSpeech("007 руб.", "ru"), "007 руб.")
})

test("prepares translated paragraphs independently of the original indices", () => {
  const paragraphs = ["Le rendez-vous commence à 20h30.", "Deuxième paragraphe."]
  const speech = createSpeechPreparation({ paragraphs, text: paragraphs.join("\n\n"), title: "", personalRules: [] }, "fr")
  const updated = "The meeting will start in the evening and we will need 2 tickets."
  const translated = speech.refresh(0, updated)
  assert.equal(translated.lang, "en")
  assert.match(translated.text, /two tickets/)
  assert.equal(speech.refresh(0, updated), translated)
  assert.match(speech.paragraphs[0]!.text, /vingt heures trente/)
  assert.deepEqual(paragraphs, ["Le rendez-vous commence à 20h30.", "Deuxième paragraphe."])
})
