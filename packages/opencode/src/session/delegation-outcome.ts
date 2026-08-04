/**
 * The durable record of how a delegation run ended.
 *
 * A delegated child's live status is cleared the moment it stops working, and
 * swarm-delegated children never get a job row - so without this, the only
 * witness to "did it work?" is the transcript, and every finished child reads
 * as an unknown `Returned` in the workflow graph. The parent that ran the
 * delegation is the one place the outcome is actually known, so it stamps the
 * child's metadata as the run progresses.
 *
 * The record is *run*-scoped, not session-scoped: a session is the workspace
 * an agent operates in, while a delegation run is one attempt to ask it to do
 * work. Each run carries its own `runID`, the parent it reports to, and an
 * attempt counter, so retries and reused `task_id` sessions cannot masquerade
 * as each other. A `running` record is written before the child starts and a
 * `settled` record replaces it from a single all-exit boundary; the only way a
 * record stays `running` is the process dying mid-run.
 *
 * `outcome` describes execution settlement only - the child returned cleanly,
 * errored, was cancelled, or was abandoned. It never claims the work was
 * verified; presentation must not dress `completed` up as verified success.
 * `deliveryOutcome` is the separate fact of whether the parent durably
 * received the report.
 */

export const DELEGATION_RECORD_VERSION = 2

export type DelegationOutcome = "completed" | "errored" | "cancelled" | "abandoned"

export type DelegationDelivery = "pending" | "delivered" | "failed"

export type DelegationRecord = {
  version: typeof DELEGATION_RECORD_VERSION
  /** Unique per delegation attempt; stale runs lose compare-and-set writes. */
  runID: string
  /** The session whose delegation this run answers - the graph edge's source. */
  parentSessionID: string
  parentMessageID?: string
  toolCallID?: string
  /** 1-based; a reused `task_id` session increments across runs. */
  attempt: number
  phase: "running" | "settled"
  /** Present once settled. Execution settlement, never semantic verification. */
  outcome?: DelegationOutcome
  startedAt: number
  completedAt?: number
  /** Display-only report opening; bounded, but still free-form model text. */
  summary?: string
  /** Whether the parent workflow durably received the report. */
  deliveryOutcome?: DelegationDelivery
  deliveredAt?: number
}

/**
 * The shape stamped before records were versioned: `{ outcome, completedAt,
 * summary? }` with `succeeded`/`failed`/`cancelled` outcomes. Still readable
 * forever - there is no migration - but never written anymore.
 */
export type LegacyDelegationOutcome = "succeeded" | "failed" | "cancelled"

/** Enough for a supervision tooltip; the transcript holds the whole report. */
const DELEGATION_SUMMARY_LIMIT = 280

/** The report's opening, whitespace-collapsed and cut at a word boundary. */
export function summarizeDelegationReport(text: string | undefined): string | undefined {
  const collapsed = text?.replace(/\s+/g, " ").trim()
  if (!collapsed) return undefined
  if (collapsed.length <= DELEGATION_SUMMARY_LIMIT) return collapsed
  const clipped = collapsed.slice(0, DELEGATION_SUMMARY_LIMIT)
  const boundary = clipped.lastIndexOf(" ")
  return `${(boundary > DELEGATION_SUMMARY_LIMIT / 2 ? clipped.slice(0, boundary) : clipped).trimEnd()}...`
}

/**
 * The metadata with the delegation record stamped in, preserving everything
 * else `metadata.opencodex` already carries (swarm id, role, depth). The
 * session store replaces whole metadata objects, so merging is the caller's
 * job - this is that merge. The summary is trimmed here so no writer can
 * exceed the bound.
 */
export function withDelegationRecord(
  metadata: Record<string, unknown> | undefined | null,
  record: DelegationRecord,
): Record<string, unknown> {
  const opencodex =
    typeof metadata?.opencodex === "object" && metadata.opencodex !== null
      ? (metadata.opencodex as Record<string, unknown>)
      : {}
  const trimmed = summarizeDelegationReport(record.summary)
  const { summary: _untrimmed, ...rest } = record
  return {
    ...(metadata ?? {}),
    opencodex: {
      ...opencodex,
      delegation: { ...rest, ...(trimmed ? { summary: trimmed } : {}) },
    },
  }
}

/** The settled successor of a `running` record, stamped at the exit boundary. */
export function settleDelegation(
  record: DelegationRecord,
  input: {
    outcome: DelegationOutcome
    summary?: string
    completedAt?: number
    deliveryOutcome?: DelegationDelivery
  },
): DelegationRecord {
  return {
    ...record,
    phase: "settled",
    outcome: input.outcome,
    completedAt: input.completedAt ?? Date.now(),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.deliveryOutcome ? { deliveryOutcome: input.deliveryOutcome } : {}),
  }
}

/** The delegation object as stored, without any validation. */
function rawDelegation(metadata: Record<string, unknown> | undefined | null): Record<string, unknown> | undefined {
  const opencodex = metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null) return undefined
  const delegation = (opencodex as { delegation?: unknown }).delegation
  if (typeof delegation !== "object" || delegation === null) return undefined
  return delegation as Record<string, unknown>
}

function isOutcome(value: unknown): value is DelegationOutcome {
  return value === "completed" || value === "errored" || value === "cancelled" || value === "abandoned"
}

function isDelivery(value: unknown): value is DelegationDelivery {
  return value === "pending" || value === "delivered" || value === "failed"
}

/**
 * Reads a current-version record back off a session's metadata. Strict: an
 * unknown version, a missing identity, or a malformed field reads as no
 * record at all - consumers must degrade to "unknown", never guess success.
 */
export function delegationRecord(
  metadata: Record<string, unknown> | undefined | null,
): DelegationRecord | undefined {
  const raw = rawDelegation(metadata)
  if (!raw) return undefined
  if (raw.version !== DELEGATION_RECORD_VERSION) return undefined
  if (typeof raw.runID !== "string" || !raw.runID) return undefined
  if (typeof raw.parentSessionID !== "string" || !raw.parentSessionID) return undefined
  if (typeof raw.attempt !== "number" || !Number.isFinite(raw.attempt) || raw.attempt < 1) return undefined
  if (raw.phase !== "running" && raw.phase !== "settled") return undefined
  if (typeof raw.startedAt !== "number" || !Number.isFinite(raw.startedAt)) return undefined
  if (raw.outcome !== undefined && !isOutcome(raw.outcome)) return undefined
  if (raw.completedAt !== undefined && (typeof raw.completedAt !== "number" || !Number.isFinite(raw.completedAt)))
    return undefined
  if (raw.deliveryOutcome !== undefined && !isDelivery(raw.deliveryOutcome)) return undefined
  return {
    version: DELEGATION_RECORD_VERSION,
    runID: raw.runID,
    parentSessionID: raw.parentSessionID,
    ...(typeof raw.parentMessageID === "string" ? { parentMessageID: raw.parentMessageID } : {}),
    ...(typeof raw.toolCallID === "string" ? { toolCallID: raw.toolCallID } : {}),
    attempt: raw.attempt,
    phase: raw.phase,
    ...(raw.outcome !== undefined ? { outcome: raw.outcome } : {}),
    startedAt: raw.startedAt,
    ...(raw.completedAt !== undefined ? { completedAt: raw.completedAt } : {}),
    ...(typeof raw.summary === "string" && raw.summary ? { summary: raw.summary } : {}),
    ...(raw.deliveryOutcome !== undefined ? { deliveryOutcome: raw.deliveryOutcome } : {}),
    ...(typeof raw.deliveredAt === "number" && Number.isFinite(raw.deliveredAt)
      ? { deliveredAt: raw.deliveredAt }
      : {}),
  }
}

/** Reads a pre-versioning stamp; see `LegacyDelegationOutcome`. */
export function legacyDelegationOutcome(
  metadata: Record<string, unknown> | undefined | null,
): LegacyDelegationOutcome | undefined {
  const raw = rawDelegation(metadata)
  if (!raw || raw.version !== undefined) return undefined
  const outcome = raw.outcome
  return outcome === "succeeded" || outcome === "failed" || outcome === "cancelled" ? outcome : undefined
}

/**
 * The settled outcome however it was recorded: current records read directly,
 * legacy stamps normalized (`succeeded` -> `completed`, `failed` ->
 * `errored`). A record still `running` has no outcome yet.
 */
export function delegationOutcome(
  metadata: Record<string, unknown> | undefined | null,
): DelegationOutcome | undefined {
  const record = delegationRecord(metadata)
  if (record) return record.phase === "settled" ? record.outcome : undefined
  const legacy = legacyDelegationOutcome(metadata)
  if (legacy === "succeeded") return "completed"
  if (legacy === "failed") return "errored"
  return legacy
}

/** Reads the recorded report summary, whichever record shape carried it. */
export function delegationSummary(
  metadata: Record<string, unknown> | undefined | null,
): string | undefined {
  const raw = rawDelegation(metadata)
  if (!raw) return undefined
  const summary = raw.summary
  return typeof summary === "string" && summary ? summary : undefined
}

/**
 * How many runs this session has already hosted, for numbering the next one.
 * Legacy stamps count as one run; their attempt was never recorded.
 */
export function delegationAttempts(metadata: Record<string, unknown> | undefined | null): number {
  const record = delegationRecord(metadata)
  if (record) return record.attempt
  return legacyDelegationOutcome(metadata) ? 1 : 0
}

/**
 * The metadata with any delegation record removed. Session forks clone
 * metadata wholesale, and a copied stamp describes the source's run, not the
 * fork - provenance the fork must not inherit.
 */
export function withoutDelegationRecord(
  metadata: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const opencodex = metadata.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("delegation" in opencodex)) return metadata
  const { delegation: _dropped, ...rest } = opencodex as Record<string, unknown>
  return { ...metadata, opencodex: rest }
}

/**
 * An incoming full-metadata replacement with the *stored* delegation record
 * carried over. The record is server-owned runtime state: a generic metadata
 * update must be able to neither erase it nor forge one, whatever the caller
 * sends under that key.
 */
export function preserveDelegationRecord(
  stored: Record<string, unknown> | undefined | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const record = rawDelegation(stored)
  const cleaned = withoutDelegationRecord(incoming) ?? {}
  if (record === undefined) return cleaned
  const opencodex =
    typeof cleaned.opencodex === "object" && cleaned.opencodex !== null
      ? (cleaned.opencodex as Record<string, unknown>)
      : {}
  return { ...cleaned, opencodex: { ...opencodex, delegation: record } }
}
