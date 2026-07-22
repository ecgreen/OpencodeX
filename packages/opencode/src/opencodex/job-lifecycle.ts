import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { OpencodeXJobTable } from "@opencode-ai/core/opencodex/sql"
import { Effect } from "effect"
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm"
import { hydrate } from "./job-model"
import {
  Event,
  TransitionError,
  type ClaimInput,
  type CompleteInput,
  type FailInput,
  type TerminalOutcome,
  type TransactionalSettlement,
} from "./job-schema"
import type { JobStore } from "./job-store"

export function createJobLifecycle(
  db: Database.Interface["db"],
  events: EventV2.Interface,
  store: JobStore,
) {
  const claim = Effect.fn("OpencodeXJob.claim")(function* (input: ClaimInput) {
    const current = yield* store.get(input.jobID)
    if (current.attempt >= current.maxAttempts) {
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: "claimed",
        message: "Job has exhausted its attempts",
      })
    }
    return yield* store.transition({
      job: current,
      target: "claimed",
      values: {
        attempt: current.attempt + 1,
        lease_owner: input.owner,
        lease_expires_at: Date.now() + input.leaseMs,
        cancel_requested_at: null,
        completed_at: null,
        failure_json: null,
        result_json: null,
        status_reason: null,
      },
    })
  })

  const start = Effect.fn("OpencodeXJob.start")(function* (jobID: string, owner: string) {
    return yield* store.transition({
      job: yield* store.get(jobID),
      target: "running",
      owner,
      values: { started_at: Date.now() },
    })
  })

  const renew = Effect.fn("OpencodeXJob.renew")(function* (input: ClaimInput) {
    const current = yield* store.get(input.jobID)
    if (!["claimed", "running"].includes(current.status) || current.leaseOwner !== input.owner) {
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: current.status,
        message: "Only the active lease owner can renew a claimed or running job",
      })
    }
    const row = yield* db
      .update(OpencodeXJobTable)
      .set({ lease_expires_at: Date.now() + input.leaseMs, time_updated: Date.now() })
      .where(
        and(
          eq(OpencodeXJobTable.id, current.id),
          eq(OpencodeXJobTable.status, current.status),
          eq(OpencodeXJobTable.lease_owner, input.owner),
        ),
      )
      .returning()
      .get()
      .pipe(Effect.orDie)
    if (row) return hydrate(row)
    return yield* new TransitionError({
      jobID: current.id,
      status: current.status,
      target: current.status,
      message: "Job changed while its lease was being renewed",
    })
  })

  const settle = Effect.fn("OpencodeXJob.settle")(function* (
    input: { jobID: string; owner: string; outcome: TerminalOutcome },
    settlement?: TransactionalSettlement,
  ) {
    const current = yield* store.get(input.jobID)
    if (current.cancelRequestedAt) {
      if (input.outcome.status === "cancelled") {
        return yield* store.transition({
          job: current,
          target: "cancelled",
          owner: input.owner,
          settlement,
          condition: isNotNull(OpencodeXJobTable.cancel_requested_at),
          values: {
            completed_at: Date.now(),
            lease_owner: null,
            lease_expires_at: null,
            status_reason: "Cancellation acknowledged after executor termination",
          },
        })
      }
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: input.outcome.status,
        message: "Job cancellation must be acknowledged before settlement",
      })
    }
    if (input.outcome.status === "cancelled") {
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: "cancelled",
        message: "Job cancellation has not been requested",
      })
    }
    return yield* store.transition({
      job: current,
      target: input.outcome.status,
      owner: input.owner,
      settlement,
      condition: isNull(OpencodeXJobTable.cancel_requested_at),
      values: {
        completed_at: Date.now(),
        lease_owner: null,
        lease_expires_at: null,
        result_json: input.outcome.status === "succeeded" ? input.outcome.result : undefined,
        status_reason: input.outcome.status === "failed" ? input.outcome.failure.message : undefined,
        failure_json: input.outcome.status === "failed" ? input.outcome.failure : undefined,
      },
    })
  })

  const succeed = Effect.fn("OpencodeXJob.succeed")(function* (input: CompleteInput) {
    return yield* settle({ jobID: input.jobID, owner: input.owner, outcome: { status: "succeeded", result: input.result } })
  })

  const fail = Effect.fn("OpencodeXJob.fail")(function* (input: FailInput) {
    return yield* settle({ jobID: input.jobID, owner: input.owner, outcome: { status: "failed", failure: input.failure } })
  })

  const retry = Effect.fn("OpencodeXJob.retry")(function* (jobID: string) {
    const current = yield* store.get(jobID)
    if (current.attempt >= current.maxAttempts) {
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: "queued",
        message: "Job has exhausted its attempts",
      })
    }
    return yield* store.transition({
      job: current,
      target: "queued",
      condition: isNull(OpencodeXJobTable.cancel_requested_at),
      values: {
        lease_owner: null,
        lease_expires_at: null,
        started_at: null,
        completed_at: null,
        result_json: null,
        failure_json: null,
        status_reason: null,
        cancel_requested_at: null,
      },
    })
  })

  const cancel = Effect.fn("OpencodeXJob.cancel")(function* (jobID: string, settlement?: TransactionalSettlement) {
    const current = yield* store.get(jobID)
    if (
      ["succeeded", "cancelled"].includes(current.status) ||
      (["failed", "interrupted"].includes(current.status) && current.attempt >= current.maxAttempts)
    )
      return current
    const now = Date.now()
    if (["queued", "failed", "interrupted"].includes(current.status)) {
      return yield* store.transition({
        job: current,
        target: "cancelled",
        settlement,
        values: {
          cancel_requested_at: now,
          completed_at: now,
          lease_owner: null,
          lease_expires_at: null,
          status_reason: "Cancelled by user",
        },
      })
    }
    if (current.cancelRequestedAt) return current
    const committed = yield* events.barrier(
      db.transaction(
        (transaction) =>
          Effect.gen(function* () {
            const row = yield* transaction
              .update(OpencodeXJobTable)
              .set({ cancel_requested_at: now, status_reason: "Cancellation requested", time_updated: now })
              .where(
                and(
                  eq(OpencodeXJobTable.id, current.id),
                  eq(OpencodeXJobTable.status, current.status),
                  eq(OpencodeXJobTable.attempt, current.attempt),
                  isNull(OpencodeXJobTable.cancel_requested_at),
                ),
              )
              .returning()
              .get()
            if (!row) return undefined
            const result = hydrate(row)
            const event = yield* events.commit(Event.Transitioned, { jobID: result.id, status: result.status })
            return { result, event }
          }),
        { behavior: "immediate" },
      ).pipe(Effect.orDie),
    )
    if (!committed) {
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: current.status,
        message: "Job changed while cancellation was being requested",
      })
    }
    yield* events.broadcast(committed.event)
    return committed.result
  })

  const acknowledgeCancel = Effect.fn("OpencodeXJob.acknowledgeCancel")(function* (jobID: string, owner: string) {
    const current = yield* store.get(jobID)
    if (current.status === "cancelled") return current
    if (!["claimed", "running"].includes(current.status) || !current.cancelRequestedAt) {
      return yield* new TransitionError({
        jobID: current.id,
        status: current.status,
        target: "cancelled",
        message: "Only an active cancellation request can be acknowledged",
      })
    }
    return yield* settle({ jobID, owner, outcome: { status: "cancelled" } })
  })

  const recover = Effect.fn("OpencodeXJob.recover")(function* (
    now = Date.now(),
    settlement?: (job: ReturnType<typeof hydrate>) => TransactionalSettlement | undefined,
  ) {
    const rows = yield* db
      .select()
      .from(OpencodeXJobTable)
      .where(
        and(
          inArray(OpencodeXJobTable.status, ["claimed", "running"]),
          or(lt(OpencodeXJobTable.lease_expires_at, now), lt(OpencodeXJobTable.timeout_at, now)),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    return yield* Effect.forEach(
      rows,
      (row) => {
        const job = hydrate(row)
        return store
          .transition({
            job,
            target: row.cancel_requested_at ? "cancelled" : "interrupted",
            owner: row.lease_owner ?? undefined,
            settlement:
              row.cancel_requested_at || row.attempt >= row.max_attempts ? settlement?.(job) : undefined,
            condition: or(lt(OpencodeXJobTable.lease_expires_at, now), lt(OpencodeXJobTable.timeout_at, now)),
            values: {
              completed_at: now,
              lease_owner: null,
              lease_expires_at: null,
              status_reason: row.cancel_requested_at
                ? "Cancellation acknowledged during startup recovery"
                : "Interrupted after an expired lease or timeout",
            },
          })
          .pipe(Effect.catchTag("OpencodeX.Job.TransitionError", () => Effect.succeed(hydrate(row))))
      },
      { concurrency: 1 },
    )
  })

  return { claim, start, renew, settle, succeed, fail, retry, cancel, acknowledgeCancel, recover }
}
