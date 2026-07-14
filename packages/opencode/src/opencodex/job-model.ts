import { OpencodeXJobTable } from "@opencode-ai/core/opencodex/sql"
import { Option, Schema } from "effect"
import { Failure, Metadata, Source, Status, type Info } from "./job-schema"

const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))
const decodeFailure = Schema.decodeUnknownOption(Failure)

export const transitions: Record<Status, Status[]> = {
  queued: ["claimed", "cancelled"],
  claimed: ["queued", "running", "cancelled", "interrupted"],
  running: ["succeeded", "failed", "cancelled", "interrupted"],
  succeeded: [],
  failed: ["queued"],
  cancelled: [],
  interrupted: ["queued"],
}

export function encode(value: Record<string, unknown> | undefined) {
  return value ? JSON.stringify(value) : undefined
}

export function hydrate(row: typeof OpencodeXJobTable.$inferSelect): Info {
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
    metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}
