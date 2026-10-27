import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { extractPackage, validatePackageDirectory } from "./support/package.mjs"

async function fixture(t, { mv = 3 } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orateur-package-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, "package")
  const manifest = {
    manifest_version: mv, version: "0.8.1", name: "__MSG_extName__", default_locale: "en",
    background: mv === 3 ? { service_worker: "background.js" } : { scripts: ["background.js"] },
    options_ui: { page: "options.html" }, icons: { 16: "icon.png" },
    [mv === 3 ? "action" : "browser_action"]: { default_popup: "popup.html", default_icon: "icon.png" },
    content_scripts: [{ matches: ["<all_urls>"], js: ["content-scripts/reader.js", "content-scripts/selection.js"], css: ["reader.css"] }],
  }
  const files = new Map(Object.entries({
    "manifest.json": JSON.stringify(manifest), "background.js": "/* background */", "icon.png": "icon",
    "options.html": '<script src="/chunks/app.js"></script><link rel="stylesheet" href="styles.css">',
    "popup.html": "<!doctype html><title>Popup</title>", "chunks/app.js": "/* app */", "styles.css": "body{}",
    "_locales/en/messages.json": JSON.stringify({ extName: { message: "Orateur" } }),
    "ort/ort.bundle.min.mjs": "/* ort */", "ort/ort-wasm-simd-threaded.jsep.mjs": "/* worker */", "ort/ort-wasm-simd-threaded.jsep.wasm": "wasm",
    "content-scripts/extract.js": "/* extract */", "content-scripts/reader.js": "/* reader */", "content-scripts/selection.js": "/* selection */",
    "reader.css": "body{}", ...(mv === 3 && { "offscreen.html": '<script type="module" src="chunks/app.js"></script>' }),
  }))
  async function write(path, contents) {
    files.set(path, contents)
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(join(directory, path), contents)
  }
  for (const [path, contents] of files) await write(path, contents)
  return { root, directory, manifest, files, write }
}

// Tiny stored ZIP fixtures keep the tests independent of a zip-writing dependency or executable.
function zip(entries) {
  const chunks = [], central = []
  let offset = 0
  for (const { name, contents = "", mode = 0o100644 } of entries) {
    const filename = Buffer.from(name), data = Buffer.from(contents)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26)
    chunks.push(local, filename, data)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8)
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(filename.length, 28); header.writeUInt32LE((mode << 16) >>> 0, 38); header.writeUInt32LE(offset, 42)
    central.push(header, filename)
    offset += local.length + filename.length + data.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, directory, end])
}

for (const mv of [2, 3]) test(`validates a complete main MV${mv} package`, async (t) => {
  const f = await fixture(t, { mv })
  assert.deepEqual(await validatePackageDirectory(f.directory, { expectedVersion: "0.8.1" }), f.manifest)
})

for (const path of ["background.js", "options.html", "popup.html", "icon.png", "content-scripts/reader.js", "reader.css", "content-scripts/extract.js", "offscreen.html", "ort/ort-wasm-simd-threaded.jsep.wasm"]) {
  test(`rejects a package missing ${path}`, async (t) => {
    const f = await fixture(t)
    await rm(join(f.directory, path))
    await assert.rejects(validatePackageDirectory(f.directory), (error) => error.message.includes(path))
  })
}

test("checks nested HTML module/style references including root-relative paths", async (t) => {
  const f = await fixture(t)
  await f.write("pages/nested.html", '<script src="../chunks/app.js?v=1"></script><link rel="stylesheet" href="/styles.css">')
  await validatePackageDirectory(f.directory)
  await f.write("pages/nested.html", '<script src="../chunks/missing.js"></script>')
  await assert.rejects(validatePackageDirectory(f.directory), /pages\/nested.html: missing.*chunks\/missing.js/)
  await f.write("pages/nested.html", '<script src="../../outside.js"></script>')
  await assert.rejects(validatePackageDirectory(f.directory), /escapes the package/)
})

test("rejects invalid, missing or malformed localization rather than producing an uninstallable ZIP", async (t) => {
  const f = await fixture(t)
  await f.write("_locales/en/messages.json", JSON.stringify({ "pronunciationError_too-long": { message: "Invalid name" } }))
  await assert.rejects(validatePackageDirectory(f.directory), /invalid Chrome i18n message name pronunciationError_too-long/)
  await f.write("_locales/en/messages.json", JSON.stringify({ other: { message: "Other" } }))
  await assert.rejects(validatePackageDirectory(f.directory), /missing default locale message extname/)
  await f.write("_locales/en/messages.json", "{")
  await assert.rejects(validatePackageDirectory(f.directory), /messages.json: invalid JSON/)
})

test("rejects a mismatched version and undeclared reader even when its file exists", async (t) => {
  const f = await fixture(t)
  await assert.rejects(validatePackageDirectory(f.directory, { expectedVersion: "0.8.2" }), /version 0.8.1.*expected 0.8.2/)
  f.manifest.content_scripts[0].js = ["content-scripts/selection.js"]
  await f.write("manifest.json", JSON.stringify(f.manifest))
  await assert.rejects(validatePackageDirectory(f.directory), /missing declared reader content script/)
})

test("rejects symlinks in an already extracted directory", async (t) => {
  const f = await fixture(t)
  await symlink(join(f.root, "outside"), join(f.directory, "linked"))
  await assert.rejects(validatePackageDirectory(f.directory), /links or special files are forbidden: linked/)
})

test("extracts and identifies the exact archive bytes and filename version", async (t) => {
  const f = await fixture(t)
  const bytes = zip([...f.files].map(([name, contents]) => ({ name, contents })))
  const archive = join(f.root, "orateur-extension-0.8.1-chrome.zip")
  await writeFile(archive, bytes)
  const result = await extractPackage(archive, join(f.root, "extracted"))
  assert.equal(result.archive, archive)
  assert.equal(result.directory, join(f.root, "extracted"))
  assert.deepEqual(result.manifest, f.manifest)
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"))
  await assert.rejects(extractPackage(archive, result.directory), /destination must be empty/)
  const wrongVersion = join(f.root, "orateur-extension-0.8.0-chrome.zip")
  await writeFile(wrongVersion, bytes)
  await assert.rejects(extractPackage(wrongVersion, join(f.root, "wrong-version")), /does not match expected 0.8.0/)
})

test("rejects ZIP traversal, duplicate paths and symlinks before extraction", async (t) => {
  const f = await fixture(t)
  const cases = [
    [{ name: "../escaped", contents: "escape" }],
    [{ name: "/absolute", contents: "escape" }],
    [{ name: "nested\\..\\escaped", contents: "escape" }],
    [{ name: "link", contents: "../outside", mode: 0o120777 }, { name: "link/escaped", contents: "escape" }],
    [{ name: "same", contents: "first" }, { name: "same", contents: "second" }],
  ]
  for (const [index, entries] of cases.entries()) {
    const archive = join(f.root, `unsafe-${index}.zip`), destination = join(f.root, `destination-${index}`)
    await writeFile(archive, zip(entries))
    await assert.rejects(extractPackage(archive, destination), /Unsafe ZIP path|links or special files|Duplicate ZIP path/)
    await assert.rejects(access(destination), { code: "ENOENT" })
  }
  await assert.rejects(access(join(f.root, "escaped")), { code: "ENOENT" })
})

test("rejects malformed and CRC-corrupted ZIPs and excludes sources", async (t) => {
  const f = await fixture(t)
  const archive = join(f.root, "broken.zip")
  await writeFile(archive, "not a ZIP")
  await assert.rejects(extractPackage(archive, join(f.root, "broken")), /Invalid ZIP/)
  const bytes = zip([...f.files].map(([name, contents]) => ({ name, contents })))
  bytes[30 + Buffer.byteLength("manifest.json")] ^= 1
  await writeFile(archive, bytes)
  await assert.rejects(extractPackage(archive, join(f.root, "corrupt")), /Cannot extract/)
  const source = join(f.root, "orateur-extension-0.8.1-sources.zip")
  await writeFile(source, bytes)
  await assert.rejects(extractPackage(source, join(f.root, "source")), /Source archive cannot be installed/)
})
