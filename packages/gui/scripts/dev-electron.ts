import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const gui = path.resolve(import.meta.dirname, "..")
const root = path.resolve(gui, "../..")
const bun = process.execPath
const children: Array<ReturnType<typeof Bun.spawn>> = []
let stopping = false

try {
  await run("build:main", [bun, "run", "build:main"])

  const vite = spawn("renderer", [bun, "run", "dev"], "pipe")
  const viteReady = waitForViteReady(vite)
  pipe(vite.stdout, process.stdout, (text) => {
    if (text.includes("Local:") || text.includes("ready in")) viteReady.resolve()
  })
  pipe(vite.stderr, process.stderr, (text) => {
    if (text.includes("Port 5173 is already in use")) {
      viteReady.reject(new Error("Port 5173 is already in use. Stop the stale dev server, then run dev:electron again."))
    }
  })

  await viteReady.promise
  await waitForRenderer()

  const electron = spawn("electron", [electronBinary(), "."], "inherit")
  const exitCode = await electron.exited
  stopChildren()
  process.exit(exitCode)
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause)
  stopChildren()
  process.exit(1)
}

async function run(name: string, command: string[]) {
  const child = spawn(name, command, "inherit")
  const code = await child.exited
  const index = children.indexOf(child)
  if (index >= 0) children.splice(index, 1)
  if (code !== 0) throw new Error(`${name} exited with ${code}`)
}

function spawn(name: string, command: string[], stdio: "inherit" | "pipe") {
  const child = Bun.spawn({
    cmd: command,
    cwd: gui,
    stdin: "inherit",
    stdout: stdio,
    stderr: stdio,
    env: process.env,
  })
  children.push(child)
  child.exited.then((code) => {
    if (stopping || name === "electron") return
    if (code !== 0) stopChildren()
  })
  return child
}

function waitForViteReady(vite: ReturnType<typeof Bun.spawn>) {
  const control = deferred()
  vite.exited.then((code) => {
    if (stopping) return
    control.reject(new Error(`Renderer dev server exited with ${code} before Electron launched.`))
  })
  return control
}

async function waitForRenderer() {
  for (const _ of Array.from({ length: 50 })) {
    try {
      const response = await fetch("http://127.0.0.1:5173")
      if (response.ok) return
    } catch {
      // Vite announced readiness; give the HTTP listener a moment to accept.
    }
    await Bun.sleep(100)
  }
  throw new Error("Renderer dev server did not respond on http://127.0.0.1:5173.")
}

async function pipe(
  stream: ReadableStream<Uint8Array> | null,
  output: NodeJS.WriteStream,
  inspect: (text: string) => void,
) {
  if (!stream) return
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) return
      output.write(result.value)
      inspect(decoder.decode(result.value, { stream: true }))
    }
  } catch (cause) {
    if (!stopping) console.error(cause)
  }
}

function electronBinary() {
  const name = process.platform === "win32" ? "electron.exe" : "electron"
  return [
    path.join(gui, "node_modules", ".bin", name),
    path.join(root, "node_modules", ".bin", name),
    "electron",
  ].find((candidate) => candidate === "electron" || fs.existsSync(candidate)) ?? "electron"
}

function deferred() {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function stopChildren() {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
}

process.once("SIGINT", () => {
  stopChildren()
  process.exit(130)
})

process.once("SIGTERM", () => {
  stopChildren()
  process.exit(143)
})
