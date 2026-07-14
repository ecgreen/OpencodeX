import path from "node:path"
import { mkdir, rm } from "node:fs/promises"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const runtime = path.join(gui, ".artifacts", "e2e", "runtime")
const backendURL = "http://127.0.0.1:4097"
const rendererURL = "http://127.0.0.1:4173"
const username = "opencode"
const password = process.env.OPENCODEX_GUI_E2E_PASSWORD ?? "opencodex-e2e"
const children: Bun.Subprocess[] = []
let stopping = false

process.once("SIGINT", () => {
  stop()
  process.exit(130)
})
process.once("SIGTERM", () => {
  stop()
  process.exit(143)
})
process.once("exit", stop)

await rm(runtime, { recursive: true, force: true })
await Promise.all(
  ["config", "data", "home", "state"].map((directory) =>
    mkdir(path.join(runtime, directory), { recursive: true }),
  ),
)

const backend = spawn(
  [
    process.execPath,
    "run",
    "--conditions=browser",
    "../opencode/src/index.ts",
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4097",
    "--cors",
    rendererURL,
    "--print-logs",
    "--log-level",
    "INFO",
  ],
  {
    XDG_CONFIG_HOME: path.join(runtime, "config"),
    XDG_DATA_HOME: path.join(runtime, "data"),
    XDG_STATE_HOME: path.join(runtime, "state"),
    OPENCODE_CONFIG_DIR: path.join(runtime, "config"),
    OPENCODE_DB: path.join(runtime, "state", "opencodex.sqlite"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
    OPENCODE_PURE: "1",
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_TEST_HOME: path.join(runtime, "home"),
  },
)

await waitForBackend(backend)

const renderer = spawn([process.execPath, "run", "dev", "--", "--port", "4173"], {
  VITE_OPENCODEX_DIRECTORY: process.env.OPENCODEX_GUI_E2E_DIRECTORY ?? root,
  VITE_OPENCODEX_SERVER_PASSWORD: password,
  VITE_OPENCODEX_SERVER_URL: backendURL,
  VITE_OPENCODEX_SERVER_USERNAME: username,
})

const result = await Promise.race([
  backend.exited.then((code) => ({ name: "backend", code })),
  renderer.exited.then((code) => ({ name: "renderer", code })),
])
stop()
throw new Error(`GUI e2e ${result.name} exited unexpectedly with code ${result.code}`)

function spawn(command: string[], environment: Record<string, string>) {
  const child = Bun.spawn({
    cmd: command,
    cwd: gui,
    env: { ...process.env, ...environment },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  children.push(child)
  return child
}

async function waitForBackend(backend: Bun.Subprocess) {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
  for (const _ of Array.from({ length: 120 })) {
    if (backend.exitCode !== null) throw new Error(`GUI e2e backend exited with code ${backend.exitCode}`)
    const response = await fetch(new URL("/global/health", backendURL), {
      headers: { authorization },
      signal: AbortSignal.timeout(1_000),
    }).catch(() => undefined)
    if (response?.ok) return
    await Bun.sleep(250)
  }
  throw new Error(`GUI e2e backend did not become healthy at ${backendURL}`)
}

function stop() {
  if (stopping) return
  stopping = true
  children.forEach((child) => child.kill())
}
