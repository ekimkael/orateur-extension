# PDF fixtures

Synthetic documents generated locally; no third-party document content.

- `simple.pdf`: one column, two paragraphs and a heading; content stream order deliberately differs from reading order.
- `multipage.pdf`: three pages, repeated headers/footers and repeated body text that must remain.
- `protected.pdf`: encrypted document; user password `secret` (no password prompt is supported).
- `restricted.pdf`: opens without a password, but copying and accessibility extraction are restricted.
- `image-only.pdf`: raster content with no text layer; must report that OCR is unavailable.

Regenerate with `python3 tests/fixtures/pdf/generate.py` using ReportLab, pypdf and Pillow. Fixed ReportLab metadata makes unencrypted fixtures reproducible; encrypted identifiers may change.
