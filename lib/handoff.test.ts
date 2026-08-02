import assert from "node:assert/strict"
import test from "node:test"
import { buildHandoffUrl, buildImportUrl, isSavable } from "./handoff.ts"

test("isSavable n'accepte que http/https", () => {
  assert.equal(isSavable("https://example.com/article"), true)
  assert.equal(isSavable("http://example.com/article"), true)
  assert.equal(isSavable("chrome://extensions"), false)
  assert.equal(isSavable("about:blank"), false)
  assert.equal(isSavable("file:///Users/x/a.html"), false)
  assert.equal(isSavable("pas une url"), false)
  assert.equal(isSavable(undefined), false)
})

test("buildHandoffUrl encode l'url et le titre", () => {
  const built = new URL(
    buildHandoffUrl("https://example.com/a?b=c&d=e", "Titre & co")
  )
  assert.equal(built.pathname, "/articles/new")
  assert.equal(built.searchParams.get("url"), "https://example.com/a?b=c&d=e")
  assert.equal(built.searchParams.get("title"), "Titre & co")
})

test("buildHandoffUrl omet un titre vide", () => {
  const built = new URL(buildHandoffUrl("https://example.com/a", "   "))
  assert.equal(built.searchParams.has("title"), false)
})

test("buildImportUrl met le payload dans le fragment, pas dans la query", () => {
  const payload = {
    content: "<p>Bonjour & bienvenue</p>",
    title: "Mon article",
    url: "https://example.com/post?a=1",
    lang: "fr-FR",
  }
  const built = new URL(buildImportUrl(payload))

  assert.equal(built.pathname, "/articles/new")
  assert.equal(built.search, "")
  // Le contrat avec readExtensionImport() côté web.
  assert.ok(built.hash.startsWith("#orateur="))
  assert.deepEqual(
    JSON.parse(decodeURIComponent(built.hash.slice("#orateur=".length))),
    payload
  )
})

test("buildImportUrl échappe les caractères qui couperaient le fragment", () => {
  const content = "<p>Titre # sous-titre &amp; suite ?q=1</p>"
  const built = new URL(buildImportUrl({ content, url: "https://example.com" }))

  assert.equal(built.search, "")
  assert.equal(
    JSON.parse(decodeURIComponent(built.hash.slice("#orateur=".length))).content,
    content
  )
})
