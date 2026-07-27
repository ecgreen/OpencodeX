import path from "node:path"
import { mkdir } from "node:fs/promises"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const compose = path.join(root, "compose.gui-e2e.yaml")

await mkdir(path.join(gui, ".artifacts"), { recursive: true })

console.log("Running headless Chromium with 2 CPU / 3 GB limits and no host display, input, or published ports.")
const testFiles = process.argv.slice(2)
const command = testFiles.length > 0 ? ["bash", "/source/packages/gui/scripts/container-e2e.sh", ...testFiles] : []
const run = Bun.spawn(["docker", "compose", "--file", compose, "run", "--rm", "--no-deps", "gui-e2e", ...command], {
  cwd: root,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await run.exited)
