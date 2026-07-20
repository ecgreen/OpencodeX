import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { packagedExecutable } from "./packaged-executable"

const root = path.resolve(import.meta.dirname, "..")
const executable = process.env.OPENCODEX_GUI_SMOKE_EXECUTABLE ?? packagedExecutable(root)

if (!executable) {
  throw new Error("No packaged OpencodeX GUI executable found. Run electron-builder with --dir first.")
}

const timeout = Number(process.env.OPENCODEX_GUI_SMOKE_TIMEOUT_MS ?? 30_000)
const temporary = await mkdtemp(path.join(os.tmpdir(), "opencodex-gui-smoke-"))
const packagedPIDFile = path.join(temporary, "packaged.pid")
let passed = false
try {
  const child = Bun.spawn(
    process.platform === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `try { $process = Start-Process -FilePath '${executable.replaceAll("'", "''")}' -PassThru; Set-Content -LiteralPath '${packagedPIDFile.replaceAll("'", "''")}' -Value $process.Id; $process.WaitForExit(); exit $process.ExitCode } catch { Write-Error $_; exit 1 }`,
        ]
      : [executable],
    {
      cwd: root,
      env: {
        ...process.env,
        XDG_CACHE_HOME: path.join(temporary, "cache"),
        XDG_CONFIG_HOME: path.join(temporary, "config"),
        XDG_DATA_HOME: path.join(temporary, "data"),
        XDG_STATE_HOME: path.join(temporary, "state"),
        OPENCODE_DB: path.join(temporary, "smoke.db"),
        OPENCODEX_GUI_SMOKE: "1",
        OPENCODEX_GUI_DIRECTORY: process.env.OPENCODEX_GUI_DIRECTORY ?? path.resolve(root, "../.."),
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      windowsHide: true,
    },
  )
  let timedOut = false
  let termination: Promise<void> | undefined
  const terminate = async () => {
    if (process.platform === "win32") {
      const packagedPID = await readFile(packagedPIDFile, "utf8")
        .then((value) => Number(value.trim()))
        .catch(() => undefined)
      const pids = new Set(
        [child.pid, packagedPID].filter((pid): pid is number => typeof pid === "number" && Number.isInteger(pid)),
      )
      await Promise.all(
        [...pids].map(async (pid) => {
          const code = await Bun.spawn(["taskkill.exe", "/PID", String(pid), "/T", "/F"], {
            stdout: "ignore",
            stderr: "ignore",
            windowsHide: true,
          }).exited
          if (code === 0) return
          try {
            process.kill(pid, "SIGKILL")
          } catch {}
        }),
      )
    }
    if (process.platform !== "win32") child.kill()
    await child.exited
    await terminateCoordinatorProcesses(temporary)
  }
  const timer = setTimeout(() => {
    timedOut = true
    termination = terminate()
  }, timeout)
  const code = await child.exited
  clearTimeout(timer)
  await termination

  if (timedOut) throw new Error(`Packaged GUI smoke timed out after ${timeout}ms.`)
  if (code !== 0) {
    await terminateCoordinatorProcesses(temporary)
    throw new Error(`Packaged GUI smoke failed with exit code ${code}.`)
  }
  passed = true
} finally {
  try {
    if (passed) await waitForCoordinatorShutdown(temporary)
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
}
console.log("Packaged GUI smoke passed.")

async function waitForCoordinatorShutdown(temporary: string) {
  const observed = new Set<number>()
  for (const _ of Array.from({ length: 60 })) {
    const coordinators = await readCoordinatorProcesses(temporary)
    coordinators.pids.forEach((pid) => observed.add(pid))
    if (coordinators.manifests === 0 && [...observed].every((pid) => !processAlive(pid))) return
    await Bun.sleep(250)
  }
  throw new Error("Packaged GUI smoke left its coordinator running after shutdown.")
}

async function terminateCoordinatorProcesses(temporary: string) {
  const observed = new Set<number>()
  for (const _ of Array.from({ length: 20 })) {
    const coordinators = await readCoordinatorProcesses(temporary)
    coordinators.pids.forEach((pid) => observed.add(pid))
    const active = [...observed].filter(processAlive)
    if (coordinators.manifests === 0 && active.length === 0) return
    active.forEach((pid) => {
      try {
        process.kill(pid, "SIGTERM")
      } catch {}
    })
    await Bun.sleep(100)
  }
  Array.from(observed).filter(processAlive).forEach((pid) => {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  })
  for (const _ of Array.from({ length: 20 })) {
    if (Array.from(observed).every((pid) => !processAlive(pid))) return
    await Bun.sleep(100)
  }
  throw new Error("Packaged GUI smoke could not terminate its coordinator process.")
}

async function readCoordinatorProcesses(temporary: string) {
  const root = path.join(temporary, "state", "opencode", "tui-coordinators")
  const manifests = (await readdir(root).catch(() => [])).filter((file) => file.endsWith(".json"))
  const pids = await Promise.all(
    manifests.map(async (file) => {
      const manifest = await readFile(path.join(root, file), "utf8")
        .then((value) => JSON.parse(value) as { pid?: unknown })
        .catch(() => undefined)
      return typeof manifest?.pid === "number" ? manifest.pid : undefined
    }),
  )
  return { manifests: manifests.length, pids: pids.filter((pid): pid is number => pid !== undefined) }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"
  }
}
