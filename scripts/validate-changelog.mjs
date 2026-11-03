// Checks CHANGELOG.md against Keep a Changelog.
// Usage: node scripts/validate-changelog.mjs [x.y.z]
// With a version, also requires a dated, non-empty section for it.
import fs from "node:fs"

const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/

/** Compares two x.y.z versions; positive when `a` is newer than `b`. */
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/**
 * Returns the problems found in a changelog; an empty list means valid.
 * Every `##` heading is `[Unreleased]` or `[x.y.z] - YYYY-MM-DD`, versions are
 * unique and newest first, and every `###` heading is a Keep a Changelog type.
 */
export function validate(text, requiredVersion) {
  const errors = []
  const versions = []
  const bullets = {}
  let current = null
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const at = `line ${i + 1}`
    if (line.startsWith("## ")) {
      const match = line.match(VERSION_HEADING)
      if (line === "## [Unreleased]") current = "Unreleased"
      else if (match) current = match[1]
      else errors.push(`${at}: bad release heading "${line}"`)
      if (match) {
        if (versions.includes(match[1])) errors.push(`${at}: duplicate version ${match[1]}`)
        versions.push(match[1])
      }
    } else if (line.startsWith("### ") && !SECTIONS.includes(line.slice(4).trim())) {
      errors.push(`${at}: unknown section "${line}" (use ${SECTIONS.join(", ")})`)
    } else if (/^\s*[-*] /.test(line) && current) {
      bullets[current] = (bullets[current] ?? 0) + 1
    }
  }
  for (let k = 1; k < versions.length; k++) {
    if (compare(versions[k - 1], versions[k]) <= 0) {
      errors.push(`versions not newest first: ${versions[k - 1]} before ${versions[k]}`)
    }
  }
  if (requiredVersion && !bullets[requiredVersion]) {
    errors.push(`missing or empty section for ${requiredVersion}`)
  }
  return errors
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const errors = validate(fs.readFileSync("CHANGELOG.md", "utf-8"), process.argv[2])
  if (errors.length) {
    console.error(`CHANGELOG.md is invalid:\n- ${errors.join("\n- ")}`)
    process.exit(1)
  }
  console.log("CHANGELOG.md is valid.")
}
