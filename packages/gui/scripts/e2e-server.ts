import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { seedPerformanceFixture } from "./seed-performance"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const productionRenderer = process.argv.includes("--production-renderer")
const runtime = path.join(gui, ".artifacts", productionRenderer ? "e2e-performance" : "e2e", "runtime")
const workspace = productionRenderer
  ? path.join(runtime, "workspace")
  : (process.env.OPENCODEX_GUI_E2E_DIRECTORY ?? root)
const backendURL = "http://127.0.0.1:4097"
const rendererPort = productionRenderer ? 4175 : 4173
const rendererURL = `http://127.0.0.1:${rendererPort}`
const username = "opencode"
const password = productionRenderer ? "opencodex-e2e" : (process.env.OPENCODEX_GUI_E2E_PASSWORD ?? "opencodex-e2e")
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
  ["config", "data", "home", "state", ...(productionRenderer ? ["workspace"] : [])].map((directory) =>
    mkdir(path.join(runtime, directory), { recursive: true }),
  ),
)
if (productionRenderer) {
  await Bun.write(path.join(workspace, "README.md"), "# Isolated GUI performance workspace\n")
  const git = Bun.spawn({
    cmd: ["git", "init", "--quiet"],
    cwd: workspace,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
  })
  const code = await git.exited
  if (code !== 0) throw new Error(`Performance workspace git init exited with code ${code}`)
}

const llm = productionRenderer
  ? undefined
  : Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response("Not found", { status: 404 })
        await Bun.sleep(500)
        return new Response(
          [
            `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] })}`,
            `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ delta: { content: "ok" } }] })}`,
            `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })

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
    ...(llm
      ? {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            model: "test/test-model",
            provider: {
              test: {
                name: "Test",
                id: "test",
                env: [],
                npm: "@ai-sdk/openai-compatible",
                models: {
                  "test-model": {
                    id: "test-model",
                    name: "Test Model",
                    attachment: false,
                    reasoning: false,
                    temperature: false,
                    tool_call: true,
                    release_date: "2025-01-01",
                    limit: { context: 100_000, output: 10_000 },
                    cost: { input: 0, output: 0 },
                    options: {},
                  },
                },
                options: { apiKey: "test-key", baseURL: new URL("/v1", llm.url).href },
              },
            },
          }),
        }
      : {}),
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_TEST_HOME: path.join(runtime, "home"),
  },
)

await waitForBackend(backend)
await initializeBackend()

if (productionRenderer) {
  const fixture = seedPerformanceFixture({
    database: path.join(runtime, "state", "opencodex.sqlite"),
    directory: workspace,
  })
  await Bun.write(path.join(runtime, "fixture.json"), JSON.stringify(fixture, null, 2))
}

const rendererEnvironment = {
  VITE_OPENCODEX_DIRECTORY: workspace,
  VITE_OPENCODEX_SERVER_PASSWORD: password,
  VITE_OPENCODEX_SERVER_URL: backendURL,
  VITE_OPENCODEX_SERVER_USERNAME: username,
  ...(productionRenderer
    ? { OPENCODEX_GUI_RENDERER_OUT_DIR: path.join(gui, ".artifacts", "e2e-performance", "renderer") }
    : {}),
}

if (productionRenderer) {
  const build = spawn([process.execPath, "run", "build:renderer"], rendererEnvironment)
  const code = await build.exited
  if (code !== 0) {
    stop()
    throw new Error(`GUI production renderer build exited with code ${code}`)
  }
}

const renderer = spawn(
  productionRenderer
    ? [process.execPath, "run", "preview:renderer", "--", "--port", String(rendererPort)]
    : [process.execPath, "run", "dev", "--", "--port", String(rendererPort)],
  rendererEnvironment,
)

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

async function initializeBackend() {
  const headers = {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "x-opencode-directory": workspace,
  }
  const response = await fetch(new URL("/experimental/opencodex/state", backendURL), {
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`GUI e2e backend initialization failed with ${response.status}: ${await response.text()}`)
  const currentSettings = await fetch(new URL("/experimental/opencodex/settings", backendURL), {
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (!currentSettings.ok)
    throw new Error(`GUI e2e settings read failed with ${currentSettings.status}: ${await currentSettings.text()}`)
  const settings = await fetch(new URL("/experimental/opencodex/settings", backendURL), {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      permission_mode: "configured",
      expectedRevision: String((await currentSettings.json()).revision),
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!settings.ok)
    throw new Error(`GUI e2e settings initialization failed with ${settings.status}: ${await settings.text()}`)
}

function stop() {
  if (stopping) return
  stopping = true
  children.forEach((child) => child.kill())
  void llm?.stop(true)
}
