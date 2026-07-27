import { expect } from "bun:test"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJobDispatcher } from "@/opencodex/job-dispatcher"
import { OpencodeXJob } from "@/opencodex/job"
import { Deferred, Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(
  OpencodeXJobDispatcher.layer({ leaseMs: 90, heartbeatMs: 20, recoveryMs: 10_000 }).pipe(
    Layer.provideMerge(OpencodeXJob.defaultLayer),
    Layer.provideMerge(EventV2Bridge.defaultLayer),
  ),
)

it.live("claims and completes queued work through a registered executor", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    let executions = 0
    let settled: OpencodeXJob.Info | undefined
    yield* dispatcher.register(
      "test.success",
      () =>
        Effect.sync(() => {
          executions += 1
          return { answer: 42 }
        }),
      (job) => Effect.succeed(Effect.sync(() => (settled = job)).pipe(Effect.asVoid)),
    )

    const created = yield* jobs.create({ kind: "test.success", idempotencyKey: "dispatcher-success" })
    const completed = yield* waitForStatus(jobs, created.id, "succeeded")

    expect(executions).toBe(1)
    expect(completed.attempt).toBe(1)
    expect(completed.result).toEqual({ answer: 42 })
    expect(completed.leaseOwner).toBeUndefined()
    yield* waitFor(() => settled !== undefined)
    expect(settled?.status).toBe("succeeded")
    expect(settled?.leaseOwner).toBeUndefined()
    expect(dispatcher.running()).toEqual([])
  }),
)

it.live("does not claim work until its durable graph is ready", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    let executions = 0
    yield* dispatcher.register("test.deferred", () =>
      Effect.sync(() => {
        executions += 1
      }),
    )

    const created = yield* jobs.create({
      kind: "test.deferred",
      idempotencyKey: "dispatcher-deferred",
      metadata: { dispatchReady: false },
    })
    yield* Effect.sleep(30)
    expect((yield* jobs.get(created.id)).status).toBe("queued")
    expect(executions).toBe(0)

    yield* jobs.update({ id: created.id, metadata: { dispatchReady: true } })
    yield* waitForStatus(jobs, created.id, "succeeded")
    expect(executions).toBe(1)
  }),
)

it.live("retries a failed execution within the persisted attempt budget", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    let executions = 0
    yield* dispatcher.register("test.retry", () => {
      executions += 1
      if (executions === 1) return Effect.fail(new Error("first attempt failed"))
      return Effect.succeed({ attempt: executions })
    })

    const created = yield* jobs.create({
      kind: "test.retry",
      idempotencyKey: "dispatcher-retry",
      maxAttempts: 2,
    })
    const completed = yield* waitForStatus(jobs, created.id, "succeeded")

    expect(executions).toBe(2)
    expect(completed.attempt).toBe(2)
    expect(completed.result).toEqual({ attempt: 2 })
  }),
)

it.live("enforces persisted timeouts and leaves no running lease", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    let aborted = false
    yield* dispatcher.register("test.timeout", (_job, signal) => waitForAbort(signal, () => (aborted = true)))

    const created = yield* jobs.create({
      kind: "test.timeout",
      idempotencyKey: "dispatcher-timeout",
      timeoutAt: Date.now() + 30,
    })
    const failed = yield* waitForStatus(jobs, created.id, "failed")

    expect(aborted).toBe(true)
    expect(failed.failure).toMatchObject({ code: "JOB_EXECUTION_FAILED", message: "Job timed out" })
    expect(failed.leaseOwner).toBeUndefined()
    expect(dispatcher.running()).toEqual([])
  }),
)

it.live("propagates cancellation to the active executor", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    const release = yield* Deferred.make<void>()
    let aborted = false
    yield* dispatcher.register("test.cancel", (_job, signal) =>
      Effect.gen(function* () {
        while (!signal.aborted) yield* Effect.sleep(5)
        aborted = true
        yield* Deferred.await(release)
        return yield* Effect.fail(new Error(String(signal.reason ?? "aborted")))
      }),
    )

    const created = yield* jobs.create({ kind: "test.cancel", idempotencyKey: "dispatcher-cancel" })
    yield* waitForStatus(jobs, created.id, "running")
    const requested = yield* jobs.cancel(created.id)
    yield* waitFor(() => aborted)

    expect(requested.status).toBe("running")
    expect(requested.cancelRequestedAt).toBeNumber()
    expect((yield* jobs.get(created.id)).status).toBe("running")
    expect((yield* jobs.get(created.id)).leaseOwner).toBeString()

    yield* Deferred.succeed(release, undefined)
    const cancelled = yield* waitForStatus(jobs, created.id, "cancelled")
    yield* waitFor(() => !dispatcher.running().includes(created.id))

    expect(cancelled.cancelRequestedAt).toBeNumber()
    expect(aborted).toBe(true)
    expect(dispatcher.running()).toEqual([])
  }),
)

it.live("releases and retries active work when a dispatcher scope stops", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const events = yield* EventV2Bridge.Service
    const created = yield* jobs.create({
      kind: "test.restart",
      idempotencyKey: "dispatcher-restart",
      maxAttempts: 2,
    })

    yield* Effect.gen(function* () {
      const dispatcher = yield* OpencodeXJobDispatcher.Service
      yield* dispatcher.register("test.restart", (_job, signal) => waitForAbort(signal, () => undefined))
      yield* waitForStatus(jobs, created.id, "running")
    }).pipe(
      Effect.provide(
        OpencodeXJobDispatcher.layer({ leaseMs: 30_000, recoveryMs: 60_000 }).pipe(
          Layer.provide(Layer.succeed(OpencodeXJob.Service, jobs)),
          Layer.provide(Layer.succeed(EventV2Bridge.Service, events)),
        ),
      ),
      Effect.scoped,
    )

    const queued = yield* waitForStatus(jobs, created.id, "queued")
    expect(queued.attempt).toBe(1)
    expect(queued.leaseOwner).toBeUndefined()
    expect(queued.statusReason).toBeUndefined()
  }),
)

it.live("runs child jobs only after their parent succeeds", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    const release = yield* Deferred.make<void>()
    let children = 0
    yield* dispatcher.register("test.parent", () => Deferred.await(release).pipe(Effect.as({ parent: true })))
    yield* dispatcher.register("test.child", () =>
      Effect.sync(() => {
        children += 1
        return { child: true }
      }),
    )

    const parent = yield* jobs.create({ kind: "test.parent", idempotencyKey: "dispatcher-parent" })
    const child = yield* jobs.create({
      kind: "test.child",
      idempotencyKey: "dispatcher-child",
      parentJobID: parent.id,
    })
    yield* waitForStatus(jobs, parent.id, "running")
    yield* Effect.sleep(30)
    expect((yield* jobs.get(child.id)).status).toBe("queued")
    expect(children).toBe(0)

    yield* Deferred.succeed(release, undefined)
    yield* waitForStatus(jobs, parent.id, "succeeded")
    yield* waitForStatus(jobs, child.id, "succeeded")
    expect(children).toBe(1)
  }),
)

it.live("cancels queued children when their parent fails", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const dispatcher = yield* OpencodeXJobDispatcher.Service
    let children = 0
    let settled: OpencodeXJob.Info | undefined
    yield* dispatcher.register("test.parent-failure", () => Effect.fail(new Error("parent failed")))
    yield* dispatcher.register(
      "test.blocked-child",
      () =>
        Effect.sync(() => {
          children += 1
        }),
      (job) => Effect.succeed(Effect.sync(() => (settled = job)).pipe(Effect.asVoid)),
    )

    const parent = yield* jobs.create({ kind: "test.parent-failure", idempotencyKey: "dispatcher-parent-failure" })
    const child = yield* jobs.create({
      kind: "test.blocked-child",
      idempotencyKey: "dispatcher-blocked-child",
      parentJobID: parent.id,
    })
    yield* waitForStatus(jobs, parent.id, "failed")
    yield* waitForStatus(jobs, child.id, "cancelled")
    yield* waitFor(() => settled !== undefined)

    expect(children).toBe(0)
    expect(settled?.status).toBe("cancelled")
  }),
)

function waitForAbort(signal: AbortSignal, onAbort: () => void) {
  return Effect.callback<Record<string, unknown>, Error>((resume) => {
    const abort = () => {
      onAbort()
      resume(Effect.fail(new Error(String(signal.reason ?? "aborted"))))
    }
    if (signal.aborted) {
      abort()
      return Effect.void
    }
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })
}

function waitForStatus(jobs: OpencodeXJob.Interface, jobID: string, status: OpencodeXJob.Status) {
  return Effect.gen(function* () {
    let current: OpencodeXJob.Info | undefined
    for (const _ of Array.from({ length: 200 })) {
      current = yield* jobs.get(jobID)
      if (current.status === status) return current
      yield* Effect.sleep(5)
    }
    return yield* Effect.die(
      `Timed out waiting for ${jobID} to reach ${status}; last status ${current?.status ?? "unknown"}`,
    )
  })
}

function waitFor(predicate: () => boolean) {
  return Effect.gen(function* () {
    for (const _ of Array.from({ length: 200 })) {
      if (predicate()) return undefined
      yield* Effect.sleep(5)
    }
    return yield* Effect.die("Timed out waiting for dispatcher condition")
  })
}
