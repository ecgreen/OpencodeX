import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "../../..")
const gui = path.resolve(import.meta.dirname, "..")
const target = process.env.OPENCODEX_GUI_SIDECAR_TARGET ?? currentTarget()
const extension = target.includes("windows") ? ".exe" : ""
const executable = `opencode-gui-coordinator${extension}`
const destination = path.join(gui, "resources", "sidecar", executable)

function currentTarget() {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `opencode-${os}-${process.arch}`
}

function candidates() {
  const explicit = process.env.OPENCODEX_GUI_SIDECAR
  return [
    explicit,
    path.join(root, "packages", "opencode", "dist", target, "bin", executable),
  ].filter(Boolean) as string[]
}

const source = candidates().find((candidate) => fs.existsSync(candidate))
if (!source) {
  throw new Error(
    [
      "No OpencodeX sidecar binary found.",
      `Expected packages/opencode/dist/${target}/bin/${executable}`,
      "Build it first with: bun run --cwd packages/opencode build --single --gui-coordinator",
      "Or set OPENCODEX_GUI_SIDECAR to an existing dedicated GUI coordinator binary.",
    ].join("\n"),
  )
}

fs.mkdirSync(path.dirname(destination), { recursive: true })
for (const name of ["opencode-gui-coordinator", "opencode-gui-coordinator.exe"]) {
  fs.rmSync(path.join(gui, "resources", "sidecar", name), { force: true })
}
fs.copyFileSync(source, destination)
if (process.platform !== "win32") fs.chmodSync(destination, 0o755)
console.log(`Copied OpencodeX sidecar: ${source} -> ${destination}`)
