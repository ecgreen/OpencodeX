import { describe, expect, test } from "bun:test"
import { createWorkerGate, WorkerShuttingDownError } from "@/cli/cmd/tui/worker-gate"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The rejection message of a promise expected to fail. */
async function failure(work: Promise<unknown>) {
  return work.then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}

/** Resolves after a couple of macrotasks, letting any early settle win first. */
function delayed<T>(value: T) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), 20))
}

describe("worker gate", () => {
  test("drain waits for in-flight work before resolving", async () => {
    const gate = createWorkerGate()
    const bootstrap = deferred<string>()
    let settled = false
    const work = gate
      .run(() => bootstrap.promise)
      .then((value) => {
        settled = true
        return value
      })

    const drain = gate.drain(5_000)
    // Shutdown must not proceed while the bootstrap is mid-flight: drain must
    // still be pending, not resolved early.
    const raced = await Promise.race([drain.then(() => "drained" as const), delayed("pending")])
    expect(raced).toBe("pending")
    expect(settled).toBe(false)

    bootstrap.resolve("booted")
    expect(await drain).toBe(true)
    expect(await work).toBe("booted")
    expect(settled).toBe(true)
  })

  test("work arriving after drain is rejected instead of racing disposal", async () => {
    const gate = createWorkerGate()
    const drain = gate.drain()
    expect(gate.draining).toBe(true)
    const rejection = await gate
      .run(async () => "late")
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rejection).toBeInstanceOf(WorkerShuttingDownError)
    expect(await drain).toBe(true)
  })

  test("drain reports false when in-flight work outlives the timeout", async () => {
    const gate = createWorkerGate()
    const hung = deferred<never>()
    const work = gate.run(() => hung.promise)
    expect(await gate.drain(10)).toBe(false)
    hung.reject(new Error("cleanup"))
    expect(await failure(work)).toBe("cleanup")
  })

  test("failed work still settles the gate and keeps its own rejection", async () => {
    const gate = createWorkerGate()
    const work = gate.run(async () => {
      throw new Error("bootstrap failed")
    })
    expect(await failure(work)).toBe("bootstrap failed")
    expect(await gate.drain(5_000)).toBe(true)
  })

  test("synchronous throws are delivered as rejections", async () => {
    const gate = createWorkerGate()
    const work = gate.run(() => {
      throw new Error("sync")
    })
    expect(await failure(work)).toBe("sync")
    expect(await gate.drain(5_000)).toBe(true)
  })
})
