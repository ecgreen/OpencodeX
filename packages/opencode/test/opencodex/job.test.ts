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
