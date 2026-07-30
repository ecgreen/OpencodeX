import { afterEach, describe, expect, test } from "bun:test"
import net from "node:net"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void Log.init({ print: false })

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}
const auth = { username: "opencode", password: "listen-secret" }

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  if (original.envPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
  else process.env.OPENCODE_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

async function startListener() {
  Flag.OPENCODE_SERVER_PASSWORD = auth.password
  Flag.OPENCODE_SERVER_USERNAME = auth.username
  process.env.OPENCODE_SERVER_PASSWORD = auth.password
  process.env.OPENCODE_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

function authorization() {
  return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
}

function stop(listener: Awaited<ReturnType<typeof startListener>>, label: string) {
  return withTimeout(listener.stop(true), 10_000, label)
}

describe("HttpApi Server.listen", () => {
  test("serves HTTP routes through Server.listen and stops cleanly", async () => {
    const listener = await startListener()
    let stopped = false
    try {
      const response = await fetch(new URL(GlobalPaths.health, listener.url), {
        headers: { authorization: authorization() },
      })
      expect(response.status).toBe(200)

      await stop(listener, "timed out waiting for listener.stop(true)")
      stopped = true

      const restarted = await startListener()
      try {
        const next = await fetch(new URL(GlobalPaths.health, restarted.url), {
          headers: { authorization: authorization() },
        })
        expect(next.status).toBe(200)
      } finally {
        await stop(restarted, "timed out waiting for restarted listener.stop(true)")
      }
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up listener").catch(() => undefined)
    }
  })

  test("stop(true) is safe when called concurrently and repeatedly", async () => {
    const listener = await startListener()
    let stopped = false
    try {
      await withTimeout(
        Promise.all([listener.stop(true), listener.stop(true)]).then(() => undefined),
        10_000,
        "timed out waiting for concurrent listener.stop(true)",
      )
      await withTimeout(listener.stop(true), 5_000, "timed out waiting for repeated listener.stop(true)")
      stopped = true
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up concurrent stop listener").catch(() => undefined)
    }
  })

  test("stop(true) can force a graceful stop already in progress", async () => {
    const listener = await startListener()
    let stopped = false
    try {
      const graceful = listener.stop()
      const forced = listener.stop(true)
      await withTimeout(
        Promise.all([graceful, forced]).then(() => undefined),
        10_000,
        "timed out waiting for forced listener stop",
      )
      stopped = true
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up forced stop listener").catch(() => undefined)
    }
  })

  test("graceful stop waits for an overlapping forced stop", async () => {
    const listener = await startListener()
    let stopped = false
    try {
      const forced = listener.stop(true)
      await withTimeout(listener.stop(), 10_000, "timed out waiting for graceful stop after forced stop")
      stopped = true
      await withTimeout(forced, 5_000, "timed out waiting for overlapping forced stop")
    } finally {
      if (!stopped) await stop(listener, "timed out cleaning up overlapping stop listener").catch(() => undefined)
    }
  })

  test("stop() gracefully closes an idle listener and is repeat-safe", async () => {
    const listener = await startListener()
    await withTimeout(listener.stop(), 10_000, "timed out waiting for graceful listener.stop()")
    await withTimeout(listener.stop(), 5_000, "timed out waiting for repeated graceful listener.stop()")
    await expect(
      fetch(new URL(GlobalPaths.health, listener.url), { headers: { authorization: authorization() } }),
    ).rejects.toThrow()
  })

  test("default in-process handler does not emit Effect HTTP response logs", async () => {
    let output = ""
    // oxlint-disable-next-line typescript-eslint/unbound-method -- restored in finally after temporarily capturing stderr.
    const original = process.stderr.write
    let status = 0
    let body = ""
    process.stderr.write = ((chunk) => {
      output += String(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      const response = await Server.Default().app.request(GlobalPaths.health)
      status = response.status
      body = await response.text()
    } finally {
      process.stderr.write = original
    }

    if (status !== 200) throw new Error(`Status endpoint returned ${status}: ${body}\n${output}`)
    expect(output).not.toContain("Sent HTTP response")
  })

  test("port 0 prefers 4096 when free", async () => {
    if (!(await isPortFree(4096))) return
    const listener = await startListener()
    try {
      expect(listener.port).toBe(4096)
    } finally {
      await stop(listener, "timed out cleaning up port-0 prefers-4096 listener")
    }
  })

  test("port 0 falls back when 4096 is taken", async () => {
    const blocker = await occupyPort(4096)
    if (!blocker) return
    try {
      const listener = await startListener()
      try {
        expect(listener.port).not.toBe(4096)
        expect(listener.port).toBeGreaterThan(0)
      } finally {
        await stop(listener, "timed out cleaning up port-0 fallback listener")
      }
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(false))
    probe.once("listening", () => probe.close(() => resolve(true)))
    probe.listen(port, "127.0.0.1")
  })
}

function occupyPort(port: number) {
  return new Promise<net.Server | undefined>((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(undefined))
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}
