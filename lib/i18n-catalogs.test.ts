import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

for (const path of ["../public/_locales/"]) {
  const directory = new URL(path, import.meta.url)
  const catalogs = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => ({
      locale: name,
      keys: Object.keys(JSON.parse(readFileSync(new URL(`${name}/messages.json`, directory), "utf8"))).sort(),
    }))

  for (const { locale, keys } of catalogs) {
    test(`${path}${locale} message names are valid Chrome extension identifiers`, () => {
      assert.deepEqual(keys.filter((key) => !/^[A-Za-z0-9_@]+$/.test(key)), [])
    })
  }

  test(`${path} locales expose the same message names`, () => {
    assert.ok(catalogs.length > 0, "at least one locale is required")
    for (const { locale, keys } of catalogs) {
      assert.deepEqual(keys, catalogs[0]!.keys, `${locale} differs from ${catalogs[0]!.locale}`)
    }
  })
}
