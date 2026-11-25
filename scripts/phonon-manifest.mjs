import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { PHONON_FILES } from "../lib/phonon/config.ts"

const [directory, baseUrl] = process.argv.slice(2)
if (!directory || !baseUrl) throw new Error("Usage: node scripts/phonon-manifest.mjs DIRECTORY BASE_URL")

const files = await Promise.all(Object.entries(PHONON_FILES).map(async ([key, name]) => {
  const path = join(directory, name)
  const { size } = await stat(path)
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return [key, { size, sha256: hash.digest("hex") }]
}))
console.log(JSON.stringify({ baseUrl, files: Object.fromEntries(files) }, null, 2))
