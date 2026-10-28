import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { extractPackage } from "../tests/support/package.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
const args = process.argv.slice(2)
const unknown = args.find((arg) => arg.startsWith("--") && arg !== "--pdf")
if (unknown) throw new Error(`Unknown argument ${unknown}; use ZIP paths and optional --pdf`)
const explicit = args.filter((arg) => arg !== "--pdf")
const archives = explicit.length ? explicit.map((path) => resolve(path)) : ["chrome", "firefox"].map((browser) => join(root, `.output/orateur-extension-${version}-${browser}.zip`))
if (args.includes("--pdf")) archives.push(...["chrome", "firefox"].map((browser) => join(root, `.output/pdf/orateur-pdf-${version}-${browser}.zip`)))
const output = join(root, ".output/test-results")
await mkdir(output, { recursive: true })
const unpacked = await mkdtemp(join(output, "packages-"))
const packages = []
try {
  for (const archive of [...new Set(archives)].filter((path) => !/-sources\.zip$/i.test(path))) {
    try {
      const { directory, ...result } = await extractPackage(archive, join(unpacked, basename(archive, ".zip")))
      packages.push({ ...result, status: "passed" })
      console.log(`Package validated: ${basename(archive)} (${result.sha256})`)
    } catch (error) {
      packages.push({ archive, status: "failed", error: error.message })
      console.error(`Package failed: ${archive}: ${error.message}`)
    }
  }
} finally {
  await rm(unpacked, { recursive: true, force: true })
}
await writeFile(join(output, "packages.json"), JSON.stringify({ generatedAt: new Date().toISOString(), packages }, null, 2) + "\n")
await writeFile(join(output, "packages.sha256"), packages.filter((item) => item.sha256).map((item) => `${item.sha256}  ${relative(join(root, ".output"), item.archive).split(sep).join("/")}\n`).join(""))
if (!packages.length || packages.some((item) => item.status === "failed")) process.exitCode = 1
