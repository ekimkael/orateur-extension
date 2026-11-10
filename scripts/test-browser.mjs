import { spawn } from "node:child_process"
import { mkdir, readdir, rm } from "node:fs/promises"

const browser = process.argv[2] ?? process.env.ORATEUR_TEST_BROWSER ?? "chrome"
if (!["chrome", "firefox"].includes(browser)) throw new Error(`Unsupported test browser: ${browser}`)
await mkdir(".output/test-results/e2e", { recursive: true })
for (const name of await readdir(".output/test-results/e2e")) {
  if (name.startsWith(`${browser}-`) || name === `${browser}.xml`) await rm(`.output/test-results/e2e/${name}`, { recursive: true, force: true })
}
const child = spawn(process.execPath, [
  "--test", "--test-concurrency=1",
  "--test-reporter=spec", "--test-reporter=junit",
  "--test-reporter-destination=stdout",
  `--test-reporter-destination=.output/test-results/e2e/${browser}.xml`,
  "tests/e2e/*.test.mjs",
], { stdio: "inherit", env: { ...process.env, ORATEUR_TEST_BROWSER: browser } })
child.on("error", error => { console.error(error); process.exitCode = 1 })
child.on("exit", code => { process.exitCode = code ?? 1 })
