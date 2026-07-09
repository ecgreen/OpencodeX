import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { OpencodeXJobTable } from "@opencode-ai/core/opencodex/sql"
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { and, eq, inArray, like, lt, notLike, or } from "drizzle-orm"

const Metadata = Schema.Record(Schema.String, Schema.Any)
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

export const Status = Schema.Literals([
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
])
export type Status = Schema.Schema.Type<typeof Status>

export const Source = Schema.Literals(["manual", "swarm", "subagent", "schedule", "trigger", "runbook", "plugin"])
export type Source = Schema.Schema.Type<typeof Source>

export const Failure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
}).annotate({ identifier: "OpencodeXJobFailure" })
export type Failure = Schema.Schema.Type<typeof Failure>
const decodeFailure = Schema.decodeUnknownOption(Failure)

export const Info = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  title: Schema.optional(Schema.String),
  status: Status,
  source: Source,
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(SessionID),
  parentJobID: Schema.optional(Schema.String),
  swarmID: Schema.optional(Schema.String),
  roleID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
  attempt: NonNegativeInt,
  maxAttempts: PositiveInt,
  leaseOwner: Schema.optional(Schema.String),
  leaseExpiresAt: Schema.optional(Schema.Number),
  timeoutAt: Schema.optional(Schema.Number),
  cancelRequestedAt: Schema.optional(Schema.Number),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  statusReason: Schema.optional(Schema.String),
  result: Schema.optional(Metadata),
  failure: Schema.optional(Failure),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXJob" })
export type Info = Schema.Schema.Type<typeof Info>

export const CreateInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  source: Schema.optional(Source),
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(SessionID),
  parentJobID: Schema.optional(Schema.String),
  swarmID: Schema.optional(Schema.String),
  roleID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
  maxAttempts: Schema.optional(PositiveInt),
  timeoutAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXJobCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const UpdateInput = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  sessionID: Schema.optional(SessionID),
  timeoutAt: Schema.optional(Schema.Number),
  statusReason: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXJobUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const ClaimInput = Schema.Struct({
  jobID: Schema.String,
  owner: Schema.String,
  leaseMs: PositiveInt,
}).annotate({ identifier: "OpencodeXJobClaimInput" })
export type ClaimInput = Schema.Schema.Type<typeof ClaimInput>

export const CompleteInput = Schema.Struct({
  jobID: Schema.String,
  owner: Schema.String,
  result: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXJobCompleteInput" })
export type CompleteInput = Schema.Schema.Type<typeof CompleteInput>

export const FailInput = Schema.Struct({
  jobID: Schema.String,
  owner: Schema.String,
  failure: Failure,
}).annotate({ identifier: "OpencodeXJobFailInput" })
export type FailInput = Schema.Schema.Type<typeof FailInput>

export const Event = {
  Created: EventV2.define({
    type: "opencodex.job.created",
    sync: { aggregate: "jobID", version: 1 },
    schema: { jobID: Schema.String, status: Status },
  }),
  Transitioned: EventV2.define({
    type: "opencodex.job.transitioned",
    sync: { aggregate: "jobID", version: 1 },
    schema: { jobID: Schema.String, status: Status },
  }),
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OpencodeX.Job.NotFoundError", {
  jobID: Schema.String,
}) {}

export class TransitionError extends Schema.TaggedErrorClass<TransitionError>()("OpencodeX.Job.TransitionError", {
  jobID: Schema.String,
  status: Status,
  target: Status,
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (jobID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly claim: (input: ClaimInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly start: (jobID: string, owner: string) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly renew: (input: ClaimInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly succeed: (input: CompleteInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly fail: (input: FailInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly retry: (jobID: string) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly cancel: (jobID: string) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly recover: (now?: number) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXJob") {}

const transitions: Record<Status, Status[]> = {
  queued: ["claimed", "cancelled"],
  claimed: ["queued", "running", "cancelled", "interrupted"],
  running: ["succeeded", "failed", "cancelled", "interrupted"],
  succeeded: [],
  failed: ["queued"],
  cancelled: [],
  interrupted: ["queued"],
}

function encode(value: Record<string, unknown> | undefined) {
  return value ? JSON.stringify(value) : undefined
}

function metadata(value: string | null) {
  return value ? Option.getOrUndefined(decodeMetadata(value)) : undefined
}

function hydrate(row: typeof OpencodeXJobTable.$inferSelect): Info {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? undefined,
    status: Schema.decodeUnknownSync(Status)(row.status),
    source: Schema.decodeUnknownSync(Source)(row.source),
    projectID: row.opencodex_project_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    parentJobID: row.parent_job_id ?? undefined,
    swarmID: row.swarm_id ?? undefined,
    roleID: row.role_id ?? undefined,
    agent: row.agent ?? undefined,
    providerID: row.provider_id ?? undefined,
    modelID: row.model_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    timeoutAt: row.timeout_at ?? undefined,
    cancelRequestedAt: row.cancel_requested_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    statusReason: row.status_reason ?? undefined,
    result: row.result_json ?? undefined,
    failure: row.failure_json ? Option.getOrUndefined(decodeFailure(row.failure_json)) : undefined,
    metadata: metadata(row.metadata_json),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service

    const list = Effect.fn("OpencodeXJob.list")(function* () {
      return (yield* db
        .select()
        .from(OpencodeXJobTable)
        .orderBy(OpencodeXJobTable.time_updated)
        .all()
        .pipe(Effect.orDie))
        .map(hydrate)
        .toReversed()
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
      const row = yield* db
        .update(OpencodeXJobTable)
        .set({ ...input.values, status: input.target, time_updated: Date.now() })
        .where(and(eq(OpencodeXJobTable.id, input.job.id), eq(OpencodeXJobTable.status, input.job.status)))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!row) {
        return yield* new TransitionError({
          jobID: input.job.id,
          status: input.job.status,
          target: input.target,
          message: "Job changed while the transition was being applied",
        })
      }
      const result = hydrate(row)
      yield* events.publish(Event.Transitioned, { jobID: result.id, status: result.status })
      return result
    })

    const create = Effect.fn("OpencodeXJob.create")(function* (input: CreateInput) {
      if (input.idempotencyKey) {
        const existing = yield* db
          .select()
          .from(OpencodeXJobTable)
          .where(eq(OpencodeXJobTable.idempotency_key, input.idempotencyKey))
          .get()
          .pipe(Effect.orDie)
        if (existing) return hydrate(existing)
      }
      const now = Date.now()
      const result = hydrate(
        yield* db
          .insert(OpencodeXJobTable)
          .values({
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
          })
          .returning()
          .get()
          .pipe(Effect.orDie),
      )
      yield* events.publish(Event.Created, { jobID: result.id, status: result.status })
      return result
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
      const row = yield* db
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
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ jobID: input.id })
      const result = hydrate(row)
      yield* events.publish(Event.Transitioned, { jobID: result.id, status: result.status })
      return result
    })

    const claim = Effect.fn("OpencodeXJob.claim")(function* (input: ClaimInput) {
      const current = yield* get(input.jobID)
      if (current.attempt >= current.maxAttempts) {
        return yield* new TransitionError({
          jobID: current.id,
          status: current.status,
          target: "claimed",
          message: "Job has exhausted its attempts",
        })
      }
      return yield* transition({
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
      const current = yield* get(jobID)
      return yield* transition({ job: current, target: "running", owner, values: { started_at: Date.now() } })
    })

    const renew = Effect.fn("OpencodeXJob.renew")(function* (input: ClaimInput) {
      const current = yield* get(input.jobID)
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
      if (!row) {
        return yield* new TransitionError({
          jobID: current.id,
          status: current.status,
          target: current.status,
          message: "Job changed while its lease was being renewed",
        })
      }
      return hydrate(row)
    })

    const succeed = Effect.fn("OpencodeXJob.succeed")(function* (input: CompleteInput) {
      const current = yield* get(input.jobID)
      return yield* transition({
        job: current,
        target: "succeeded",
        owner: input.owner,
        values: {
          completed_at: Date.now(),
          lease_owner: null,
          lease_expires_at: null,
          result_json: input.result,
        },
      })
    })

    const fail = Effect.fn("OpencodeXJob.fail")(function* (input: FailInput) {
      const current = yield* get(input.jobID)
      return yield* transition({
        job: current,
        target: "failed",
        owner: input.owner,
        values: {
          completed_at: Date.now(),
          lease_owner: null,
          lease_expires_at: null,
          status_reason: input.failure.message,
          failure_json: input.failure,
        },
      })
    })

    const retry = Effect.fn("OpencodeXJob.retry")(function* (jobID: string) {
      const current = yield* get(jobID)
      if (current.attempt >= current.maxAttempts) {
        return yield* new TransitionError({
          jobID: current.id,
          status: current.status,
          target: "queued",
          message: "Job has exhausted its attempts",
        })
      }
      return yield* transition({
        job: current,
        target: "queued",
        values: {
          lease_owner: null,
          lease_expires_at: null,
          started_at: null,
          completed_at: null,
          result_json: null,
          failure_json: null,
          status_reason: null,
        },
      })
    })

    const cancel = Effect.fn("OpencodeXJob.cancel")(function* (jobID: string) {
      const current = yield* get(jobID)
      if (["succeeded", "failed", "cancelled", "interrupted"].includes(current.status)) return current
      const now = Date.now()
      return yield* transition({
        job: current,
        target: "cancelled",
        values: {
          cancel_requested_at: now,
          completed_at: now,
          lease_owner: null,
          lease_expires_at: null,
          status_reason: "Cancelled by user",
        },
      })
    })

    const recover = Effect.fn("OpencodeXJob.recover")(function* (now = Date.now()) {
      const rows = yield* db
        .select()
        .from(OpencodeXJobTable)
        .where(
          and(
            inArray(OpencodeXJobTable.status, ["claimed", "running"]),
            or(
              lt(OpencodeXJobTable.lease_expires_at, now),
              lt(OpencodeXJobTable.timeout_at, now),
              and(
                like(OpencodeXJobTable.lease_owner, "local:%"),
                notLike(OpencodeXJobTable.lease_owner, `local:${process.pid}:%`),
              ),
            ),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      return yield* Effect.forEach(
        rows,
        (row) =>
          transition({
            job: hydrate(row),
            target: "interrupted",
            values: {
              completed_at: now,
              lease_owner: null,
              lease_expires_at: null,
              status_reason: "Interrupted after an expired lease or timeout",
            },
          }).pipe(Effect.catchTag("OpencodeX.Job.TransitionError", () => Effect.succeed(hydrate(row)))),
        { concurrency: 1 },
      )
    })

    yield* recover()
    return Service.of({ list, get, create, update, claim, start, renew, succeed, fail, retry, cancel, recover })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2Bridge.defaultLayer))

export * as OpencodeXJob from "./job"
