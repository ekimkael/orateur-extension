import assert from "node:assert/strict"
import test from "node:test"
import { SITE_CLEANUPS, siteCleanup } from "./sites.ts"

test("a site rule is found by its host, with or without www", () => {
  assert.equal(siteCleanup("www.bbc.com"), SITE_CLEANUPS.get("bbc.com"))
  assert.equal(siteCleanup("bbc.co.uk"), SITE_CLEANUPS.get("bbc.com"), "both BBC hosts share one rule")
  assert.ok(siteCleanup("fr.wikipedia.org"), "every Wikipedia language is covered")
})

test("unknown hosts and inherited keys find no rule", () => {
  for (const host of ["example.com", "constructor", "__proto__", "toString", "wikipedia.org"]) {
    assert.equal(siteCleanup(host), undefined, host)
  }
})
