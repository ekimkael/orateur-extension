import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "wxt"

// A separate public directory prevents a PDF build from adding assets to the main extension.
const root = dirname(fileURLToPath(import.meta.url))
const publicDir = join(root, "optional/pdf/public")
mkdirSync(publicDir, { recursive: true })
cpSync(join(root, "public/icon"), join(publicDir, "icon"), { recursive: true })
mkdirSync(join(publicDir, "ort"), { recursive: true })
for (const file of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs", "ort.bundle.min.mjs"]) {
  copyFileSync(join(root, "node_modules/onnxruntime-web/dist", file), join(publicDir, "ort", file))
}
const pdfjs = join(root, "node_modules/pdfjs-dist")
copyFileSync(join(pdfjs, "legacy/build/pdf.worker.min.mjs"), join(publicDir, "pdf.worker.min.mjs"))
for (const dir of ["cmaps", "standard_fonts"]) {
  cpSync(join(pdfjs, dir), join(publicDir, "pdf-assets", dir), { recursive: true })
}
copyFileSync(join(pdfjs, "LICENSE"), join(publicDir, "pdf-assets/LICENSE"))
for (const locale of ["fr", "en"]) {
  const shared = JSON.parse(readFileSync(join(root, "public/_locales", locale, "messages.json"), "utf8"))
  const pdf = JSON.parse(readFileSync(join(root, "optional/pdf/locales", locale, "messages.json"), "utf8"))
  const target = join(publicDir, "_locales", locale)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, "messages.json"), JSON.stringify({ ...shared, ...pdf }))
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  entrypointsDir: "optional/pdf/entrypoints",
  publicDir: "optional/pdf/public",
  outDir: ".output/pdf",
  webExt: process.env.FIREFOX_BIN ? { binaries: { firefox: process.env.FIREFOX_BIN } } : undefined,
  zip: {
    name: "orateur-pdf",
    excludeSources: ["public/ort/**", "optional/pdf/public/**", "scratchpad/**", "plans/**"],
  },
  manifest: ({ browser, manifestVersion }) => ({
    default_locale: "en",
    name: "__MSG_pdfTitle__",
    description: "__MSG_pdfDescription__",
    action: { default_title: "__MSG_menuReadPdfTitle__" },
    permissions: ["activeTab", "contextMenus", "storage", "unlimitedStorage", ...(manifestVersion === 2 ? ["http://*/*", "https://*/*", "file:///*"] : [])],
    ...(manifestVersion === 3 && {
      host_permissions: ["http://*/*", "https://*/*", "file:///*"],
      cross_origin_opener_policy: { value: "same-origin" },
      cross_origin_embedder_policy: { value: "require-corp" },
      content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'" },
    }),
    ...(browser === "firefox" && {
      browser_specific_settings: { gecko: {
        id: "orateur-pdf@ekimkael",
        data_collection_permissions: { required: ["none"] },
      } },
    }),
  }),
})
