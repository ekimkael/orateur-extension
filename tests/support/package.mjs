import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const ortFiles = ["ort.bundle.min.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]

function inside(directory, path) {
  const rel = relative(directory, path)
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

// Inspect central-directory metadata before unzip can create files or follow a symlink.
function checkArchive(data) {
  let end = data.length - 22
  const lower = Math.max(0, end - 65535)
  for (; end >= lower; end--) {
    if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break
  }
  if (end < lower) throw new Error("Invalid ZIP: end of central directory not found")
  const count = data.readUInt16LE(end + 10)
  const size = data.readUInt32LE(end + 12)
  let offset = data.readUInt32LE(end + 16)
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || count === 65535 || offset === 0xffffffff || size === 0xffffffff) {
    throw new Error("Split or ZIP64 archives are unsupported; build a normal extension ZIP")
  }
  const limit = offset + size
  if (!count || limit > end) throw new Error("Invalid ZIP central directory")
  const names = new Set()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > limit || data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP entry metadata")
    const nameLength = data.readUInt16LE(offset + 28)
    const next = offset + 46 + nameLength + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32)
    if (next > limit) throw new Error("Truncated ZIP entry metadata")
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength)
    const parts = name.replace(/\/$/, "").split("/")
    if (!name || /[\x00-\x1f\x7f\\]/.test(name) || name.startsWith("/") || /^[a-z]:/i.test(name) || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe ZIP path: ${JSON.stringify(name)}`)
    }
    const key = name.replace(/\/$/, "").toLowerCase()
    if (names.has(key)) throw new Error(`Duplicate ZIP path: ${name}`)
    names.add(key)
    const type = (data.readUInt32LE(offset + 38) >>> 16) & 0xf000
    if (type && type !== 0x8000 && type !== 0x4000) throw new Error(`ZIP links or special files are forbidden: ${name}`)
    if (data.readUInt16LE(offset + 8) & 1) throw new Error(`Encrypted ZIP entry: ${name}`)
    offset = next
  }
  if (offset !== limit) throw new Error("Invalid ZIP central-directory size")
}

async function packageFiles(directory) {
  const files = []
  async function visit(path) {
    for (const name of await readdir(path)) {
      const entry = resolve(path, name)
      const stat = await lstat(entry)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Package links or special files are forbidden: ${relative(directory, entry)}`)
      if (!inside(directory, await realpath(entry))) throw new Error(`Package path escapes its directory: ${entry}`)
      if (stat.isDirectory()) await visit(entry)
      else files.push(entry)
    }
  }
  await visit(directory)
  return files
}

export async function validatePackageDirectory(path, { expectedVersion } = {}) {
  const directory = await realpath(path)
  const files = await packageFiles(directory)
  const known = new Set(files)
  async function requireFile(ref, source = "manifest.json") {
    if (typeof ref !== "string" || !ref) throw new Error(`${source}: invalid package file reference`)
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) throw new Error(`${source}: expected a local package file, got ${ref}`)
    let decoded
    try { decoded = decodeURIComponent(ref.split(/[?#]/)[0]) } catch { throw new Error(`${source}: invalid encoded path ${ref}`) }
    const target = decoded.startsWith("/") ? resolve(directory, `.${decoded}`) : resolve(dirname(resolve(directory, source)), decoded)
    if (!inside(directory, target)) throw new Error(`${source}: file reference escapes the package: ${ref}`)
    if (!known.has(target) || !(await lstat(target)).size) throw new Error(`${source}: missing or empty package file ${ref}`)
    return target
  }
  async function json(ref) {
    const file = await requireFile(ref)
    try { return JSON.parse(await readFile(file, "utf8")) } catch (error) { throw new Error(`${ref}: invalid JSON (${error.message})`) }
  }
  const manifest = await json("manifest.json")
  if (!manifest || ![2, 3].includes(manifest.manifest_version) || typeof manifest.version !== "string" || !manifest.name) throw new Error("manifest.json: missing extension name/version or unsupported manifest_version")
  if (expectedVersion && manifest.version !== expectedVersion) throw new Error(`manifest.json: version ${manifest.version} does not match expected ${expectedVersion}`)
  const refs = []
  const icons = (value) => typeof value === "string" ? [value] : Object.values(value ?? {})
  refs.push(...icons(manifest.icons), ...(manifest.background?.scripts ?? []))
  for (const ref of [manifest.background?.service_worker, manifest.background?.page, manifest.options_page, manifest.options_ui?.page, manifest.devtools_page, manifest.side_panel?.default_path]) {
    if (ref !== undefined) refs.push(ref)
  }
  for (const action of [manifest.action, manifest.browser_action, manifest.page_action]) {
    if (action?.default_popup !== undefined) refs.push(action.default_popup)
    refs.push(...icons(action?.default_icon))
  }
  for (const script of manifest.content_scripts ?? []) refs.push(...(script.js ?? []), ...(script.css ?? []))
  refs.push(...Object.values(manifest.chrome_url_overrides ?? {}), ...(manifest.sandbox?.pages ?? []))
  for (const ref of refs) await requireFile(ref)

  const catalogs = new Map()
  for (const file of files.filter((file) => /[/\\]_locales[/\\][^/\\]+[/\\]messages\.json$/.test(file))) {
    const ref = relative(directory, file)
    const catalog = await json(ref)
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) throw new Error(`${ref}: expected a message catalog object`)
    const keys = new Map()
    for (const [key, value] of Object.entries(catalog)) {
      if (!/^[A-Za-z0-9_@]+$/.test(key)) throw new Error(`${ref}: invalid Chrome i18n message name ${key}`)
      if (keys.has(key.toLowerCase())) throw new Error(`${ref}: duplicate case-insensitive message name ${key}`)
      if (typeof value?.message !== "string") throw new Error(`${ref}: ${key} requires a string message`)
      keys.set(key.toLowerCase(), value)
    }
    catalogs.set(relative(resolve(directory, "_locales"), dirname(file)), keys)
  }
  const localized = [...JSON.stringify(manifest).matchAll(/__MSG_(.+?)__/g)].map((match) => match[1].toLowerCase())
  if (manifest.default_locale || localized.length || catalogs.size) {
    const defaults = catalogs.get(manifest.default_locale)
    if (!defaults) throw new Error(`manifest.json: missing default locale catalog ${manifest.default_locale ?? "(default_locale is unset)"}`)
    for (const key of localized) if (!key.startsWith("@@") && !defaults.has(key)) throw new Error(`manifest.json: missing default locale message ${key}`)
  }

  for (const file of files.filter((file) => file.endsWith(".html"))) {
    const html = (await readFile(file, "utf8")).replace(/<!--[\s\S]*?-->/g, "")
    for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const attribute = tag[1].toLowerCase() === "script" ? "src" : "href"
      const match = tag[0].match(new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
      const ref = match?.[1] ?? match?.[2] ?? match?.[3]
      if (ref && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref)) await requireFile(ref, relative(directory, file))
    }
  }
  for (const file of ortFiles) await requireFile(`ort/${file}`, "runtime")
  for (const file of ["extract", "reader", "selection"]) await requireFile(`content-scripts/${file}.js`, "runtime")
  if (manifest.manifest_version === 3) await requireFile("offscreen.html", "runtime")
  const declared = new Set((manifest.content_scripts ?? []).flatMap((script) => script.js ?? []).map((ref) => ref.replace(/^\//, "")))
  for (const script of ["reader", "selection"]) if (!declared.has(`content-scripts/${script}.js`)) throw new Error(`manifest.json: missing declared ${script} content script`)
  return manifest
}

export async function extractPackage(path, destination, options = {}) {
  const archive = await realpath(path)
  if (/-sources\.zip$/i.test(archive)) throw new Error(`Source archive cannot be installed: ${archive}`)
  const data = await readFile(archive)
  checkArchive(data)
  const directory = resolve(destination)
  try {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Extraction destination is a symlink: ${directory}`)
    if ((await readdir(directory)).length) throw new Error(`Extraction destination must be empty: ${directory}`)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  await mkdir(directory, { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), "orateur-archive-"))
  try {
    const snapshot = join(temporary, "package.zip")
    await writeFile(snapshot, data, { mode: 0o600 })
    await run("unzip", ["-oq", snapshot, "-d", directory])
  } catch (error) {
    throw new Error(`Cannot extract ${archive}: ${error.stderr?.trim() || error.message}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  const encodedVersion = archive.match(/orateur-extension-(\d+(?:\.\d+){1,3})-(?:chrome|firefox)\.zip$/)?.[1]
  const manifest = await validatePackageDirectory(directory, { expectedVersion: encodedVersion, ...options })
  return { directory: await realpath(directory), manifest, archive, sha256: createHash("sha256").update(data).digest("hex") }
}
