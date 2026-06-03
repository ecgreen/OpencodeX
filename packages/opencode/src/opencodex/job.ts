import { OpencodeXJobTable } from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { eq } from "drizzle-orm"

const Metadata = Schema.Record(Schema.String, Schema.Unknown)
const decodeMetadata = Schema.decodeUnknownSync(Schema.fromJsonString(Metadata))

export const Status = Schema.Literals([
  "queued",
  "running",
  "input_needed",
  "approval_needed",
  "blocked",
  "failed",
  "completed",
  "cancelled",
  "stale",
])
export type Status = Schema.Schema.Type<typeof Status>

export const Source = Schema.Literals(["manual", "swarm", "subagent", "schedule", "trigger", "runbook", "plugin"])
export type Source = Schema.Schema.Type<typeof Source>

export const Info = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  title: Schema.optional(Schema.String),
  status: Status,
  source: Source,
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  parentJobID: Schema.optional(Schema.String),
  swarmID: Schema.optional(Schema.String),
  roleID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  statusReason: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXJob" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const CreateInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  source: Schema.optional(Source),
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  parentJobID: Schema.optional(Schema.String),
  swarmID: Schema.optional(Schema.String),
  roleID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  statusReason: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXJobCreateInput" })
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const UpdateInput = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  sessionID: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  statusReason: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXJobUpdateInput" })
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OpencodeX.Job.NotFoundError", {
  jobID: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (jobID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly cancel: (jobID: string) => Effect.Effect<Info, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXJob") {}

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

function hydrate(row: typeof OpencodeXJobTable.$inferSelect): Info {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? undefined,
    status: row.status as Status,
    source: row.source as Source,
    projectID: row.opencodex_project_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    parentJobID: row.parent_job_id ?? undefined,
    swarmID: row.swarm_id ?? undefined,
    roleID: row.role_id ?? undefined,
    agent: row.agent ?? undefined,
    providerID: row.provider_id ?? undefined,
    modelID: row.model_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    statusReason: row.status_reason ?? undefined,
    metadata: row.metadata_json ? decodeMetadata(row.metadata_json) : undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const list = Effect.fn("OpencodeXJob.list")(function* () {
      return (yield* db.select().from(OpencodeXJobTable).orderBy(OpencodeXJobTable.time_updated).all().pipe(Effect.orDie))
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

    const create = Effect.fn("OpencodeXJob.create")(function* (input: CreateInput) {
      const now = Date.now()
      return hydrate(
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
            started_at: input.startedAt,
            status_reason: input.statusReason,
            metadata_json: serializeMetadata(input.metadata),
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
          .pipe(Effect.orDie),
      )
    })

    const update = Effect.fn("OpencodeXJob.update")(function* (input: UpdateInput) {
      yield* get(input.id)
      return hydrate(
        yield* db
          .update(OpencodeXJobTable)
          .set({
            title: input.title,
            status: input.status,
            session_id: input.sessionID,
            started_at: input.startedAt,
            completed_at: input.completedAt,
            status_reason: input.statusReason,
            metadata_json: serializeMetadata(input.metadata),
            time_updated: Date.now(),
          })
          .where(eq(OpencodeXJobTable.id, input.id))
          .returning()
          .get()
          .pipe(Effect.orDie),
      )
    })

    const cancel = Effect.fn("OpencodeXJob.cancel")(function* (jobID: string) {
      return yield* update({
        id: jobID,
        status: "cancelled",
        completedAt: Date.now(),
        statusReason: "Cancelled by user",
      })
    })

    return Service.of({ list, get, create, update, cancel })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export * as OpencodeXJob from "./job"
