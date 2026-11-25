# Personal pronunciation

In settings, add a rule with **French** or **English**, the written text, its spoken replacement and optional **Match case**. Changes apply from the next reading. Rules are stored locally in the browser (`orateur:pronunciation-rules`), without synchronization.

Limits: **200 rules**, **100 characters** for written text and **200 characters** for the spoken replacement, counted as Unicode code points. Both fields are required. Outer whitespace is trimmed, text is normalized to NFC, and invisible control or format characters are rejected.

Rules apply to articles and selected text with Supertonic and system voices. Pocket TTS uses the shared text normalization and keeps personal rules saved for the engines that support them. The rule language follows the language resolved for each paragraph. Short or ambiguous passages inherit nearby context or the document language; an English quotation inside a French paragraph is not detected separately.

- Matching ignores Unicode case by default. Use strict case to distinguish `API` from `Api`. Accents remain significant: `café` and `cafe` differ, while equivalent Unicode spellings match.
- Matching is literal, without regular expressions. Letters, numbers, combining marks and `_` extend a word; punctuation, apostrophes and hyphens delimit it. `API` matches in `l’API` and `API-REST`, but not in `APIs`, `API2` or `API_`. Add plurals and other variants explicitly.
- Matching proceeds left to right. At the same position, the longest phrase wins, then the case-sensitive rule. Replacements do not trigger other personal rules and bypass Verbalis. Speech engines still apply their own encoding and model-specific processing.
- Duplicates with the same language, case mode and normalized source are rejected. Case is ignored in duplicate checks for case-insensitive rules.

**Listen** uses the current engine, voice and speed and is available for Supertonic and system voices. Preview stops any current reading in the same extension, without resuming it automatically. If the Supertonic model is missing, a link opens its download settings; preview never downloads it automatically. A selected system voice remains the global choice even when its language differs from the rule's language.

Preview works for saved rules and a valid unsaved draft. It applies only the rule being previewed. Click **Stop**, edit the draft, or change the engine, voice or speed to stop it. Listening does not save the draft; use **Save** to apply it to future readings.

Storage failures are shown in settings. A failed save keeps the draft available for retry, and a failed delete leaves the rule in the list. If rules cannot be loaded, use **Retry** before editing them.

## Text normalization

[Verbalis](https://github.com/software-mansion-labs/Verbalis) prepares speech for all engines. It expands numbers, dates, times, currencies, measures, abbreviations, URLs and symbols according to the paragraph language. The same preparation runs on text updated in the page and on previews synthesized on demand. The extension keeps original paragraph boundaries for highlighting and saved progress.

Speech preparation removes emoji sequences from spoken text in every language. Ordinary text symbols remain available to the normalizer. A paragraph emptied by emoji removal is skipped during playback and retains its original position.

Verbalis supports German, English, Spanish, French, Hindi, Italian, Polish, Portuguese and Chinese. Other languages use only emoji filtering. English uses the known US or UK region. Ambiguous numeric slash dates retain their written order for English without a US region, because Verbalis also interprets them as US dates in its UK mode.

English reads standalone `μ`, `Ω` and `Δ` as “mu”, “omega” and “delta”. The temperature-difference notation `ΔT` reads “delta T”. After a quantity, `Ω` reads “ohm” or “ohms”, and `μg` and `µg` read “microgram” or “micrograms”.

For French text, Orateur adapts a few forms before Verbalis. `6H45` uses the same hour notation as `6h45`. `24H/24` and `7J/7` expand to “vingt-quatre heures sur vingt-quatre” and “sept jours sur sept”. Versions such as `v2.3.1`, `version 2.0` and `OAuth 2.0` use “point”. Roman numerals after `section` use the same reading as after `chapitre`.

Midnight uses “minuit” for clock times, including “à minuit trente” for `à 00H30` and “vers minuit quarante-cinq” for `vers 00:45`. Duration contexts and timecodes retain their usual normalization.

Grouped international phone numbers keep their written groups. The country code and groups longer than two digits are read digit by digit. A phone label disambiguates runs of three-digit groups from signed quantities. Ticket numbers introduced by `Ticket #` use “numéro” followed by individual digits, and `EN_ATTENTE` becomes “en attente” after a status label. Numeric quantities expand `mAh` and `Mb/s`, and the division sign `÷` reads “divisé par”. French text expands `FCFA` to “franc CFA” or “francs CFA” according to the amount. Personal replacements bypass these adjustments.

In French, standalone Greek letters `μ`, `Ω` and `Δ` read “mu”, “oméga” and “delta”. The extra readings leave unit and formula tokens such as `10 Ω`, `μg` and `ΔT` to Verbalis.

## Verification

```sh
rtk npm test
rtk npm run compile
```

Tests cover validation, storage, Unicode boundaries, conflicts, replacement protection, Verbalis output and the same preparation for live and static text. Inspecting prepared text does not replace listening with the intended voices.

The [browser suite](testing.md) also covers rule validation, persistence, editing and deletion through the settings UI. Preview pronunciation and voice quality still require listening with the intended engine.
