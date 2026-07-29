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

/**
 * Version of the backend the packaged app ships, stamped next to the binary so
 * the Electron main process can present it in the coordinator handshake. The
 * opencode build writes `dist/<target>/package.json` with the same
 * `Script.version` it defines as `OPENCODE_VERSION`, so that file is the
 * authority rather than a value recomputed here.
 */
function sidecarVersion() {
  if (process.env.OPENCODEX_GUI_SIDECAR_VERSION) return process.env.OPENCODEX_GUI_SIDECAR_VERSION
  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(root, "packages", "opencode", "dist", target, "package.json"), "utf8"),
    )
    if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
      if (typeof manifest.version === "string" && manifest.version.length > 0) return manifest.version
    }
  } catch {
    // Fall through: an explicitly supplied binary carries no build manifest.
  }
  return "local"
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
const version = sidecarVersion()
const stamp = path.join(gui, "resources", "sidecar", "version.json")
fs.writeFileSync(stamp, `${JSON.stringify({ version }, null, 2)}\n`)
console.log(`Copied OpencodeX sidecar: ${source} -> ${destination}`)
console.log(`Stamped OpencodeX sidecar version ${version} -> ${stamp}`)
