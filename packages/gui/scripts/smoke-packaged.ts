import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const executable = process.env.OPENCODEX_GUI_SMOKE_EXECUTABLE ?? findPackagedExecutable()

if (!executable) {
  throw new Error("No packaged OpencodeX GUI executable found. Run electron-builder with --dir first.")
}

const timeout = Number(process.env.OPENCODEX_GUI_SMOKE_TIMEOUT_MS ?? 30_000)
const child = spawn(executable, [], {
  cwd: root,
  env: {
    ...process.env,
    OPENCODEX_GUI_SMOKE: "1",
    OPENCODEX_GUI_DIRECTORY: process.env.OPENCODEX_GUI_DIRECTORY ?? path.resolve(root, "../.."),
  },
  stdio: "inherit",
  windowsHide: true,
})

const timer = setTimeout(() => {
  child.kill()
  console.error(`Packaged GUI smoke timed out after ${timeout}ms.`)
  process.exit(1)
}, timeout)

child.on("exit", (code) => {
  clearTimeout(timer)
  if (code === 0) {
    console.log("Packaged GUI smoke passed.")
    process.exit(0)
  }
  console.error(`Packaged GUI smoke failed with exit code ${code ?? "unknown"}.`)
  process.exit(1)
})

child.on("error", (error) => {
  clearTimeout(timer)
  console.error(error)
  process.exit(1)
})

function findPackagedExecutable() {
  return candidateExecutables().find((candidate) => fs.existsSync(candidate))
}

function candidateExecutables() {
  if (process.platform === "win32") {
    return [
      path.join(root, "release", "win-unpacked", "opencodex-gui.exe"),
      path.join(root, "release", "win-unpacked", "OpencodeX.exe"),
    ]
  }
  if (process.platform === "darwin") {
    return [
      path.join(root, "release", "mac", "OpencodeX.app", "Contents", "MacOS", "opencodex-gui"),
      path.join(root, "release", "mac-arm64", "OpencodeX.app", "Contents", "MacOS", "opencodex-gui"),
    ]
  }
  return [
    path.join(root, "release", "linux-unpacked", "opencodex-gui"),
  ]
}
