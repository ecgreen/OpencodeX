import { ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"

export type SidecarConnection = {
  url: string
  username: string
  password: string
  directory: string
}

type SidecarState = {
  child?: ChildProcessWithoutNullStreams
  connection?: SidecarConnection
  startup?: Promise<SidecarConnection>
}

const state: SidecarState = {}
const LISTENING = /listening on (https?:\/\/[^\s]+)/i

function bundledBinary() {
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  return path.join(process.resourcesPath, "sidecar", executable)
}

function devBinary() {
  return process.env.OPENCODEX_GUI_SIDECAR ?? "opencodex"
}

function command() {
  if (app.isPackaged) {
    const binary = bundledBinary()
    if (!fs.existsSync(binary)) throw new Error(`Missing packaged OpencodeX sidecar binary: ${binary}`)
    return binary
  }
  return devBinary()
}

function serverArgs() {
  return ["serve", "--hostname", "127.0.0.1", "--port", "0"]
}

function workingDirectory() {
  return process.env.OPENCODEX_GUI_DIRECTORY ?? process.env.INIT_CWD ?? process.cwd()
}

export function startSidecar() {
  if (state.connection) return Promise.resolve(state.connection)
  if (state.startup) return state.startup

  const username = "opencode"
  const password = randomBytes(24).toString("base64url")
  const directory = workingDirectory()
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(command(), serverArgs(), {
      cwd: directory,
      env: {
        ...process.env,
        OPENCODE_CLI_NAME: "opencodex",
        OPENCODE_SERVER_USERNAME: username,
        OPENCODE_SERVER_PASSWORD: password,
      },
      windowsHide: true,
    })
  } catch (error) {
    return Promise.reject(error)
  }
  state.child = child

  state.startup = new Promise<SidecarConnection>((resolve, reject) => {
    let settled = false

    function cleanup() {
      state.startup = undefined
      if (!state.connection) state.child = undefined
    }

    function fail(error: Error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      if (!child.killed) child.kill(process.platform === "win32" ? undefined : "SIGTERM")
      reject(error)
    }

    const timeout = setTimeout(() => {
      fail(new Error("Timed out waiting for OpencodeX sidecar to start"))
    }, 30_000)

    function finish(connection: SidecarConnection) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      state.connection = connection
      resolve(connection)
    }

    function inspect(chunk: Buffer) {
      const text = chunk.toString("utf8")
      const match = LISTENING.exec(text)
      if (match) finish({ url: match[1], username, password, directory })
    }

    child.stdout.on("data", inspect)
    child.stderr.on("data", inspect)
    child.once("error", (error) => {
      fail(error)
    })
    child.once("exit", (code, signal) => {
      const started = !!state.connection
      state.child = undefined
      state.connection = undefined
      state.startup = undefined
      if (!started) fail(new Error(`OpencodeX sidecar exited before startup (${signal ?? code ?? "unknown"})`))
    })
  })

  return state.startup
}

export function stopSidecar() {
  const child = state.child
  state.child = undefined
  state.connection = undefined
  state.startup = undefined
  if (!child || child.killed) return
  child.kill(process.platform === "win32" ? undefined : "SIGTERM")
}
