import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import {
  MAX_SELECTION_LENGTH,
  MIN_SELECTION_LENGTH,
  extractSelectionText,
  normalizeSelectionText,
  rangesToText,
  validateSelectionText,
} from "./selection-text.ts"

function bodyOf(html: string) {
  return new JSDOM(`<body>${html}</body>`).window.document.body
}

function textOf(html: string) {
  return extractSelectionText(bodyOf(html))
}

test("aplatit le balisage inline sans laisser de HTML", () => {
  assert.equal(
    textOf("<p>Bonjour <strong>tout</strong> le monde</p>"),
    "Bonjour tout le monde"
  )
  assert.equal(textOf("Bonjour <b>tout</b> le monde"), "Bonjour tout le monde")
})

test("sépare les paragraphes par une ligne vide", () => {
  assert.equal(
    textOf("<p>Premier paragraphe.</p><p>Deuxième paragraphe.</p>"),
    "Premier paragraphe.\n\nDeuxième paragraphe."
  )
})

test("sépare les items de liste", () => {
  assert.equal(
    textOf("<ul><li>Premier élément</li><li>Deuxième élément</li></ul>"),
    "Premier élément\n\nDeuxième élément"
  )
})

test("lit les cellules d'un tableau dans l'ordre du document", () => {
  assert.equal(
    textOf(
      "<table><tr><td>Cellule 1</td><td>Cellule 2</td></tr><tr><td>Cellule 3</td></tr></table>"
    ),
    "Cellule 1\n\nCellule 2\n\nCellule 3"
  )
})

test("garde le libellé d'un lien et jette son URL", () => {
  assert.equal(
    textOf('<a href="https://example.com/tracking?utm=x">Visiter notre site</a>'),
    "Visiter notre site"
  )
})

test("ignore les éléments sans prose", () => {
  assert.equal(
    textOf(
      "<p>Visible</p><script>window.x = 1</script><style>p{color:red}</style>" +
        '<p aria-hidden="true">Décoratif</p><p hidden>Masqué</p>'
    ),
    "Visible"
  )
})

test("un <br> coupe la ligne sans ouvrir un paragraphe", () => {
  assert.equal(textOf("<p>Ligne 1<br>Ligne 2</p>"), "Ligne 1\nLigne 2")
})

test("normalise les blancs sans toucher au texte", () => {
  assert.equal(
    textOf("<p>  Trop\t\td'espaces ici  </p>"),
    "Trop d'espaces ici"
  )
  assert.equal(normalizeSelectionText("a\n\n\n\n\nb"), "a\n\nb")
})

test("traverse l'Unicode intact", () => {
  for (const sample of ["こんにちは世界", "مرحبا بالعالم", "Bonjour 👋", "Größe"]) {
    assert.equal(textOf(`<p>${sample}</p>`), sample)
  }
})

test("rangesToText aplatit une sélection partielle", () => {
  const { document } = new JSDOM(
    "<body><p>Bonjour <b>tout</b> le monde</p><p>Suite.</p></body>"
  ).window
  const range = document.createRange()
  range.selectNodeContents(document.body)

  assert.equal(rangesToText([range]), "Bonjour tout le monde\n\nSuite.")
})

test("rangesToText concatène les plages multiples (Firefox)", () => {
  const { document } = new JSDOM("<body><p>Un</p><p>Deux</p></body>").window
  const ranges = Array.from(document.querySelectorAll("p"), (p) => {
    const range = document.createRange()
    range.selectNodeContents(p)
    return range
  })

  assert.equal(rangesToText(ranges), "Un\n\nDeux")
})

test("refuse une sélection vide ou uniquement blanche", () => {
  for (const raw of ["", "   ", "\n\n", "\t \n\t"]) {
    assert.deepEqual(validateSelectionText(raw), {
      ok: false,
      reason: "empty",
    })
  }
})

test("refuse une sélection sous le minimum", () => {
  assert.deepEqual(validateSelectionText("ab"), {
    ok: false,
    reason: "too-short",
  })
  assert.equal(validateSelectionText("a".repeat(MIN_SELECTION_LENGTH)).ok, true)
})

test("accepte une sélection normale sans la modifier", () => {
  assert.deepEqual(validateSelectionText("  Bonjour tout le monde  "), {
    ok: true,
    text: "Bonjour tout le monde",
    truncated: false,
  })
})

test("tronque une sélection démesurée au lieu de la refuser", () => {
  const result = validateSelectionText(`${"mot ".repeat(MAX_SELECTION_LENGTH)}fin`)

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.truncated, true)
  assert.ok(result.text.length <= MAX_SELECTION_LENGTH)
  // Coupé à une frontière de mot, pas au milieu.
  assert.ok(result.text.endsWith("mot"))
})

test("tronque sans casser une paire de substituts", () => {
  // Aucun espace : la coupure tombe forcément au caractère près.
  const result = validateSelectionText("👋".repeat(MAX_SELECTION_LENGTH))

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(!/[\uD800-\uDBFF]$/.test(result.text))
  assert.equal(result.text, [...result.text].join(""))
})
