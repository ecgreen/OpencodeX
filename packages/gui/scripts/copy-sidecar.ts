import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "../../..")
const gui = path.resolve(import.meta.dirname, "..")
const target = process.env.OPENCODEX_GUI_SIDECAR_TARGET ?? currentTarget()
const extension = process.platform === "win32" ? ".exe" : ""
const destination = path.join(gui, "resources", "sidecar", `opencode${extension}`)

function currentTarget() {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `opencode-${os}-${process.arch}`
}

function candidates() {
  const explicit = process.env.OPENCODEX_GUI_SIDECAR
  return [
    explicit,
    path.join(root, "packages", "opencode", "dist", target, "bin", `opencode${extension}`),
    path.join(root, "packages", "opencode", "dist", target, "bin", "opencode"),
  ].filter(Boolean) as string[]
}

const source = candidates().find((candidate) => fs.existsSync(candidate))
if (!source) {
  throw new Error(
    [
      "No OpencodeX sidecar binary found.",
      `Expected packages/opencode/dist/${target}/bin/opencode${extension}`,
      "Build it first with: bun run --cwd packages/opencode build --single --skip-embed-web-ui",
      "Or set OPENCODEX_GUI_SIDECAR to an existing opencode/opencodex binary.",
    ].join("\n"),
  )
}

fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.copyFileSync(source, destination)
if (process.platform !== "win32") fs.chmodSync(destination, 0o755)
console.log(`Copied OpencodeX sidecar: ${source} -> ${destination}`)
