import { expect } from "bun:test"
import { OpencodeXJob } from "@/opencodex/job"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(OpencodeXJob.defaultLayer)

it.live("submits idempotently and runs the legal lifecycle", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({
      kind: "test",
      idempotencyKey: "job-lifecycle",
      maxAttempts: 2,
    })
    const duplicate = yield* jobs.create({
      kind: "ignored-by-idempotency",
      idempotencyKey: "job-lifecycle",
      maxAttempts: 2,
    })

    expect(duplicate.id).toBe(created.id)
    expect(duplicate.kind).toBe("test")

    const claimed = yield* jobs.claim({ jobID: created.id, owner: "runner-a", leaseMs: 30_000 })
    expect(claimed.status).toBe("claimed")
    expect(claimed.attempt).toBe(1)
    expect(claimed.leaseOwner).toBe("runner-a")

    const running = yield* jobs.start(created.id, "runner-a")
    expect(running.status).toBe("running")

    const succeeded = yield* jobs.succeed({ jobID: created.id, owner: "runner-a", result: { answer: 42 } })
    expect(succeeded.status).toBe("succeeded")
    expect(succeeded.result).toEqual({ answer: 42 })
    expect(succeeded.leaseOwner).toBeUndefined()
  }),
)

it.live("rolls back terminal job state when transactional settlement fails", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({ kind: "test", idempotencyKey: "job-settlement-rollback" })
    yield* jobs.claim({ jobID: created.id, owner: "runner-a", leaseMs: 30_000 })
    yield* jobs.start(created.id, "runner-a")

    const exit = yield* jobs
      .settle(
        { jobID: created.id, owner: "runner-a", outcome: { status: "succeeded", result: { ignored: true } } },
        () => Effect.die("aggregate settlement failed"),
      )
      .pipe(Effect.exit)

    expect(exit._tag).toBe("Failure")
    const running = yield* jobs.get(created.id)
    expect(running.status).toBe("running")
    expect(running.leaseOwner).toBe("runner-a")
    yield* jobs.succeed({ jobID: created.id, owner: "runner-a", result: { recovered: true } })
  }),
)

it.live("rejects illegal transitions and a different lease owner", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({ kind: "test", idempotencyKey: "job-owner" })

    const startError = yield* Effect.flip(jobs.start(created.id, "runner-a"))
    expect(startError._tag).toBe("OpencodeX.Job.TransitionError")

    yield* jobs.claim({ jobID: created.id, owner: "runner-a", leaseMs: 30_000 })
    const ownerError = yield* Effect.flip(jobs.start(created.id, "runner-b"))
    expect(ownerError._tag).toBe("OpencodeX.Job.TransitionError")
  }),
)

it.live("interrupts work with an expired lease and permits a bounded retry", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({
      kind: "test",
      idempotencyKey: "job-recovery",
      maxAttempts: 2,
    })
    yield* jobs.claim({ jobID: created.id, owner: "runner-a", leaseMs: 1 })
    yield* jobs.start(created.id, "runner-a")

    const recovered = yield* jobs.recover(Date.now() + 10_000)
    expect(recovered.find((job) => job.id === created.id)?.status).toBe("interrupted")

    const queued = yield* jobs.retry(created.id)
    expect(queued.status).toBe("queued")
    yield* jobs.claim({ jobID: created.id, owner: "runner-b", leaseMs: 30_000 })
    yield* jobs.start(created.id, "runner-b")
    yield* jobs.fail({
      jobID: created.id,
      owner: "runner-b",
      failure: { code: "TEST_FAILURE", message: "expected failure" },
    })

    const retryError = yield* Effect.flip(jobs.retry(created.id))
    expect(retryError._tag).toBe("OpencodeX.Job.TransitionError")
  }),
)

it.live("makes cancellation terminal and idempotent", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({ kind: "test", idempotencyKey: "job-cancel" })
    const cancelled = yield* jobs.cancel(created.id)
    const repeated = yield* jobs.cancel(created.id)

    expect(cancelled.status).toBe("cancelled")
    expect(repeated.status).toBe("cancelled")
    expect(repeated.id).toBe(created.id)
  }),
)

it.live("keeps active cancellation nonterminal until the lease owner acknowledges termination", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({ kind: "test", idempotencyKey: "job-active-cancel" })
    yield* jobs.claim({ jobID: created.id, owner: "runner-a", leaseMs: 30_000 })
    yield* jobs.start(created.id, "runner-a")

    const requested = yield* jobs.cancel(created.id)
    expect(requested.status).toBe("running")
    expect(requested.cancelRequestedAt).toBeNumber()
    expect(requested.leaseOwner).toBe("runner-a")
    expect(requested.leaseExpiresAt).toBeNumber()

    const completionError = yield* Effect.flip(
      jobs.succeed({ jobID: created.id, owner: "runner-a", result: { ignored: true } }),
    )
    expect(completionError._tag).toBe("OpencodeX.Job.TransitionError")

    const cancelled = yield* jobs.acknowledgeCancel(created.id, "runner-a")
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.leaseOwner).toBeUndefined()
    expect(cancelled.completedAt).toBeNumber()
  }),
)

it.live("acknowledges cancellation while recovering an abandoned lease", () =>
  Effect.gen(function* () {
    const jobs = yield* OpencodeXJob.Service
    const created = yield* jobs.create({ kind: "test", idempotencyKey: "job-cancel-recovery" })
    yield* jobs.claim({ jobID: created.id, owner: "local:999999:old", leaseMs: 1 })
    yield* jobs.start(created.id, "local:999999:old")
    yield* jobs.cancel(created.id)

    const recovered = yield* jobs.recover(Date.now() + 10_000)
    expect(recovered.find((job) => job.id === created.id)?.status).toBe("cancelled")
    expect((yield* jobs.get(created.id)).statusReason).toBe("Cancellation acknowledged during startup recovery")
  }),
)
