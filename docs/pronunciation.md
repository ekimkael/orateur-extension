# Personal pronunciation

In settings, add a rule with **French** or **English**, the written text, its spoken replacement and optional **Match case**. Changes apply from the next reading. Rules are stored locally in the browser (`orateur:pronunciation-rules`), without synchronization.

Limits: **200 rules**, **100 characters** for written text and **200 characters** for the spoken replacement, counted as Unicode code points. Both fields are required. Outer whitespace is trimmed, text is normalized to NFC, and invisible control or format characters are rejected.

Rules apply to articles and selected text with both speech engines. Their language follows the language resolved for each paragraph. Short or ambiguous passages inherit nearby context or the document language; an English quotation inside a French paragraph is not detected separately.

- Matching ignores Unicode case by default. Use strict case to distinguish `API` from `Api`. Accents remain significant: `café` and `cafe` differ, while equivalent Unicode spellings match.
- Matching is literal, without regular expressions. Letters, numbers, combining marks and `_` extend a word; punctuation, apostrophes and hyphens delimit it. `API` matches in `l’API` and `API-REST`, but not in `APIs`, `API2` or `API_`. Add plurals and other variants explicitly.
- Matching proceeds left to right. At the same position, the longest phrase wins, then the case-sensitive rule. Replacements do not trigger other personal rules and bypass built-in preparation rules. Speech engines still apply their own text preprocessing, including Supertonic's number and punctuation normalization.
- Duplicates with the same language, case mode and normalized source are rejected. Case is ignored in duplicate checks for case-insensitive rules.

**Listen** uses the current engine, voice and speed. Preview stops any current reading in the same extension, without resuming it automatically. If the Supertonic model is missing, a link opens its download settings; preview never downloads it automatically. A selected system voice remains the global choice even when its language differs from the rule's language.

Preview works for saved rules and a valid unsaved draft. It applies only the rule being previewed. Click **Stop**, edit the draft, or change the engine, voice or speed to stop it. Listening does not save the draft; use **Save** to apply it to future readings.

Storage failures are shown in settings. A failed save keeps the draft available for retry, and a failed delete leaves the rule in the list. If rules cannot be loaded, use **Retry** before editing them.

## Numbers

Built-in preparation removes recognized thousands separators before synthesis: `40 000` becomes `40000`. Regular, nonbreaking and narrow nonbreaking spaces are accepted in French and English; English comma grouping is also accepted. Decimal parts follow the paragraph language: `40 000,50` in French and `40,000.50` in English. Signs are preserved.

Leading-zero codes and common phone number formats are not regrouped. An ambiguous sequence such as `123 456 789` is treated as a quantity. Personal rules match before this preparation step; the selected engine may further preprocess their output. Final pronunciation depends on the engine and voice, so these transformations cannot guarantee every numeric interpretation.

## Verification

```sh
rtk npm test
rtk npm run compile
```

Tests cover validation, storage, Unicode boundaries, conflicts, replacement protection during preparation and number normalization. Inspecting prepared text does not replace listening with the intended voices.

The [browser suite](testing.md) also covers rule validation, persistence, editing and deletion through the settings UI. Preview pronunciation and voice quality still require listening with the intended engine.
