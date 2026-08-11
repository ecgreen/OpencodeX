import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { createSidecarLifecycle, stopDetachedChild } from "../src/main/sidecar-lifecycle"

describe("sidecar lifecycle", () => {
  test("shares a successful startup and resets it on stop", async () => {
    const connection = { url: "http://127.0.0.1:4096" }
    const installed: typeof connection[] = []
    let starts = 0
    const lifecycle = createSidecarLifecycle({
      start: async () => {
        starts += 1
        return connection
      },
      install: (value) => installed.push(value),
      reset: () => {},
      stop: () => {},
    })

    const first = lifecycle.ensure()
    const second = lifecycle.ensure()

    expect(first).toBe(second)
    expect(await first).toBe(connection)
    expect(await lifecycle.ensure()).toBe(connection)
    expect(starts).toBe(1)
    expect(installed).toEqual([connection])

    await lifecycle.stop()

    expect(await lifecycle.ensure()).toBe(connection)
    expect(starts).toBe(2)
    expect(installed).toEqual([connection, connection])
  })

  test("retries after startup rejects", async () => {
    let starts = 0
    const lifecycle = createSidecarLifecycle({
      start: async () => {
        starts += 1
        if (starts === 1) throw new Error("not ready")
        return "ready"
      },
      install: () => {},
      reset: () => {},
      stop: () => {},
    })

    await expect(lifecycle.ensure()).rejects.toThrow("not ready")
    expect(await lifecycle.ensure()).toBe("ready")
    expect(starts).toBe(2)
  })

  test("shares concurrent shutdown cleanup", async () => {
    const cleanup = Promise.withResolvers<void>()
    let stops = 0
    const lifecycle = createSidecarLifecycle({
      start: async () => "ready",
      install: () => {},
      reset: () => {},
      stop: () => {
        stops += 1
        return cleanup.promise
      },
    })
    await lifecycle.ensure()

    const first = lifecycle.stop()
    const second = lifecycle.stop()

    expect(first).toBe(second)
    expect(stops).toBe(1)
    cleanup.resolve()
    await first
  })

  test("waits for shutdown cleanup before restarting", async () => {
    const cleanup = Promise.withResolvers<void>()
    let starts = 0
    const lifecycle = createSidecarLifecycle({
      start: async () => `connection-${++starts}`,
      install: () => {},
      reset: () => {},
      stop: () => cleanup.promise,
    })
    expect(await lifecycle.ensure()).toBe("connection-1")

    const stopping = lifecycle.stop()
    const restarting = lifecycle.ensure()
    expect(starts).toBe(1)
    cleanup.resolve()

    await stopping
    expect(await restarting).toBe("connection-2")
  })

  test("aborts and rejects stale completion after stop", async () => {
    const pending = Promise.withResolvers<string>()
    const signals: AbortSignal[] = []
    const installed: string[] = []
    let resets = 0
    let stops = 0
    let starts = 0
    const lifecycle = createSidecarLifecycle({
      start: (signal) => {
        signals.push(signal)
        starts += 1
        return starts === 1 ? pending.promise : Promise.resolve("fresh")
      },
      install: (value) => installed.push(value),
      reset: () => {
        resets += 1
      },
      stop: () => {
        stops += 1
      },
    })

    const stale = lifecycle.ensure()
    const stopping = lifecycle.stop()
    pending.resolve("stale")
    await stopping

    expect(signals[0]?.aborted).toBe(true)
    await expect(stale).rejects.toMatchObject({ name: "AbortError" })
    expect(installed).toEqual([])
    expect(resets).toBe(1)
    expect(stops).toBe(1)
    expect(await lifecycle.ensure()).toBe("fresh")
    expect(installed).toEqual(["fresh"])
  })

  test("invalidates a cached connection after a failed health check", async () => {
    let starts = 0
    let resets = 0
    let stops = 0
    let healthy = true
    const lifecycle = createSidecarLifecycle({
      start: async () => `connection-${++starts}`,
      health: async () => healthy,
      install: () => {},
      reset: () => {
        resets += 1
      },
      stop: () => {
        stops += 1
      },
    })

    expect(await lifecycle.ensure()).toBe("connection-1")
    expect(await lifecycle.ensure()).toBe("connection-1")
    healthy = false
    expect(await lifecycle.ensure()).toBe("connection-2")
    expect(starts).toBe(2)
    expect(resets).toBe(1)
    expect(stops).toBe(1)
  })

  test("awaits startup cancellation and captured child cleanup on quit", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      // Mirrors the production spawn: detached on every platform so a console
      // signal aimed at the spawner cannot take the coordinator down with it.
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
    const lifecycle = createSidecarLifecycle({
      start: (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"))
          }, { once: true })
        }),
      install: () => {},
      reset: () => {},
      stop: () => stopDetachedChild(child),
    })

    const startup = lifecycle.ensure()
    const stopped = lifecycle.stop()
    expect(child.killed).toBe(true)
    await stopped
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    await expect(startup).rejects.toMatchObject({ name: "AbortError" })
  })
})
