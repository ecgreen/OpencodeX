import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { OpencodeXJobTable } from "@opencode-ai/core/opencodex/sql"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Effect } from "effect"
import { and, eq, inArray, type SQL } from "drizzle-orm"
import { encode, hydrate, transitions } from "./job-model"
import {
  Event,
  NotFoundError,
  TransitionError,
  type CreateInput,
  type Info,
  type Status,
  type Transaction,
  type TransactionalSettlement,
  type UpdateInput,
} from "./job-schema"

export const insertJob = Effect.fnUntraced(function* (
  transaction: Transaction,
  events: EventV2.Interface,
  input: CreateInput,
) {
  const now = Date.now()
  const values = {
    id: input.id ?? `oxj_${Identifier.ascending()}`,
    kind: input.kind,
    title: input.title,
    status: input.status ?? "queued",
    source: input.source ?? "manual",
    opencodex_project_id: input.projectID,
    session_id: input.sessionID,
    parent_job_id: input.parentJobID,
    swarm_id: input.swarmID,
    role_id: input.roleID,
    agent: input.agent,
    provider_id: input.providerID,
    model_id: input.modelID,
    idempotency_key: input.idempotencyKey,
    max_attempts: input.maxAttempts ?? 1,
    timeout_at: input.timeoutAt,
    metadata_json: encode(input.metadata),
    time_created: now,
    time_updated: now,
  }
  const insert = transaction.insert(OpencodeXJobTable).values(values)
  const row = yield* (input.idempotencyKey ? insert.onConflictDoNothing().returning().get() : insert.returning().get())
  if (!row) {
    if (!input.idempotencyKey) return yield* Effect.die(new Error("Job insert did not return the inserted row"))
    const existing = yield* transaction
      .select()
      .from(OpencodeXJobTable)
      .where(eq(OpencodeXJobTable.idempotency_key, input.idempotencyKey))
      .get()
    if (!existing) return yield* Effect.die(new Error("Idempotent job insert did not return a winner"))
    return { result: hydrate(existing), event: undefined }
  }
  const result = hydrate(row)
  const event = yield* events.commit(Event.Created, { jobID: result.id, status: result.status })
  return { result, event }
})

export function createJobStore(db: Database.Interface["db"], events: EventV2.Interface) {
  // The dispatcher wakes on a timer and only ever cares about queued work, so
  // it passes a status filter instead of hydrating the whole table each tick.
  const list = Effect.fn("OpencodeXJob.list")(function* (input?: { statuses?: readonly Status[] }) {
    const statuses = input?.statuses
    const query = db.select().from(OpencodeXJobTable)
    return (yield* (statuses ? query.where(inArray(OpencodeXJobTable.status, [...statuses])) : query)
      .orderBy(OpencodeXJobTable.time_updated)
      .all()
      .pipe(Effect.orDie))
      .map(hydrate)
      .toReversed()
  })

  const getMany = Effect.fn("OpencodeXJob.getMany")(function* (jobIDs: readonly string[]) {
    if (jobIDs.length === 0) return [] as Info[]
    return (yield* db
      .select()
      .from(OpencodeXJobTable)
      .where(inArray(OpencodeXJobTable.id, [...jobIDs]))
      .all()
      .pipe(Effect.orDie)).map(hydrate)
  })

  const get = Effect.fn("OpencodeXJob.get")(function* (jobID: string) {
    const row = yield* db
      .select()
      .from(OpencodeXJobTable)
      .where(eq(OpencodeXJobTable.id, jobID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFoundError({ jobID })
    return hydrate(row)
  })

  const transition = Effect.fn("OpencodeXJob.transition")(function* (input: {
    job: Info
    target: Status
    owner?: string
    values?: Partial<typeof OpencodeXJobTable.$inferInsert>
    settlement?: TransactionalSettlement
    condition?: SQL
  }) {
    if (!transitions[input.job.status].includes(input.target)) {
      return yield* new TransitionError({
        jobID: input.job.id,
        status: input.job.status,
        target: input.target,
        message: `Cannot transition ${input.job.status} to ${input.target}`,
      })
    }
    if (input.owner && input.job.leaseOwner !== input.owner) {
      return yield* new TransitionError({
        jobID: input.job.id,
        status: input.job.status,
        target: input.target,
        message: "Job lease is owned by another runner",
      })
    }
    const committed = yield* events.barrier(
      db.transaction(
        (transaction) =>
          Effect.gen(function* () {
            const row = yield* transaction
              .update(OpencodeXJobTable)
              .set({ ...input.values, status: input.target, time_updated: Date.now() })
              .where(
                and(
                  eq(OpencodeXJobTable.id, input.job.id),
                  eq(OpencodeXJobTable.status, input.job.status),
                  eq(OpencodeXJobTable.attempt, input.job.attempt),
                  input.owner ? eq(OpencodeXJobTable.lease_owner, input.owner) : undefined,
                  input.condition,
                ),
              )
              .returning()
              .get()
            if (!row) return undefined
            const result = hydrate(row)
            const afterCommit = input.settlement ? yield* input.settlement(result, transaction) : Effect.void
            const event = yield* events.commit(Event.Transitioned, { jobID: result.id, status: result.status })
            return { result, event, afterCommit }
          }),
        { behavior: "immediate" },
      ).pipe(Effect.orDie),
    )
    if (!committed) {
      return yield* new TransitionError({
        jobID: input.job.id,
        status: input.job.status,
        target: input.target,
        message: "Job changed while the transition was being applied",
      })
    }
    yield* events.broadcast(committed.event)
    yield* committed.afterCommit
    return committed.result
  })

  const create = Effect.fn("OpencodeXJob.create")(function* (input: CreateInput) {
    const committed = yield* events.barrier(
      db
        .transaction((transaction) => insertJob(transaction, events, input), { behavior: "immediate" })
        .pipe(Effect.orDie),
    )
    if (committed.event) yield* events.broadcast(committed.event)
    return committed.result
  })

  const update = Effect.fn("OpencodeXJob.update")(function* (input: UpdateInput) {
    const current = yield* get(input.id)
    if (input.status && input.status !== current.status) {
      return yield* transition({
        job: current,
        target: input.status,
        values: {
          title: input.title,
          session_id: input.sessionID,
          timeout_at: input.timeoutAt,
          status_reason: input.statusReason,
          metadata_json: encode(input.metadata),
        },
      })
    }
    const committed = yield* events.barrier(
      db.transaction(
        (transaction) =>
          Effect.gen(function* () {
            const row = yield* transaction
              .update(OpencodeXJobTable)
              .set({
                title: input.title,
                session_id: input.sessionID,
                timeout_at: input.timeoutAt,
                status_reason: input.statusReason,
                metadata_json: encode(input.metadata),
                time_updated: Date.now(),
              })
              .where(eq(OpencodeXJobTable.id, input.id))
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
    if (!committed) return yield* new NotFoundError({ jobID: input.id })
    yield* events.broadcast(committed.event)
    return committed.result
  })

  return { list, getMany, get, transition, create, update }
}

export type JobStore = ReturnType<typeof createJobStore>
