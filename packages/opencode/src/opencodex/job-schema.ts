import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { NonNegativeInt, PositiveInt } from "@opencode-ai/core/schema"
import { SessionID } from "@/session/schema"
import { Context, Effect, Schema } from "effect"

export const Metadata = Schema.Record(Schema.String, Schema.Any)

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

export type Transaction = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]
export type TransactionalSettlement = (
  job: Info,
  transaction: Transaction,
) => Effect.Effect<Effect.Effect<void>, never>

export type TerminalOutcome =
  | { status: "succeeded"; result?: Record<string, unknown> }
  | { status: "failed"; failure: Failure }
  | { status: "cancelled" }

export interface Interface {
  readonly list: (input?: { statuses?: readonly Status[] }) => Effect.Effect<Info[]>
  readonly getMany: (jobIDs: readonly string[]) => Effect.Effect<Info[]>
  readonly get: (jobID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly claim: (input: ClaimInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly start: (jobID: string, owner: string) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly renew: (input: ClaimInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly succeed: (input: CompleteInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly fail: (input: FailInput) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly settle: (
    input: { jobID: string; owner: string; outcome: TerminalOutcome },
    settlement?: TransactionalSettlement,
  ) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly retry: (jobID: string) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly cancel: (
    jobID: string,
    settlement?: TransactionalSettlement,
  ) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly acknowledgeCancel: (jobID: string, owner: string) => Effect.Effect<Info, NotFoundError | TransitionError>
  readonly recover: (
    now?: number,
    settlement?: (job: Info) => TransactionalSettlement | undefined,
  ) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXJob") {}
