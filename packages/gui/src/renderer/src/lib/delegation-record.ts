import type { Session } from "@opencode-ai/sdk/v2/client"

/**
 * The one decoder for the durable delegation record a parent stamps on a
 * delegated child's metadata; see packages/opencode
 * session/delegation-outcome.ts for the producer. Every GUI consumer reads
 * through here so the contract cannot drift between modules.
 *
 * The rules are deliberately conservative:
 * - an unknown version, malformed field, or unrecognised outcome reads as no
 *   record at all - the graph degrades to "returned", never to success;
 * - a versioned record is honored only when its recorded parent matches the
 *   session's actual parent, so a record can never dress up a session that is
 *   not the child it was stamped on;
 * - a session with no parent never wears a record - a delegation outcome only
 *   describes a child, and forks (which clone metadata) become roots;
 * - `completed` means execution settlement only: the child returned cleanly.
 *   No verifier ran, and presentation must not imply one did.
 */

export type DelegationRecordOutcome = "completed" | "errored" | "cancelled" | "abandoned"

export type DelegationRecordDelivery = "pending" | "delivered" | "failed"

export type DelegationRecordView = {
  phase: "running" | "settled"
  /** Present once settled. Execution settlement, never verified success. */
  outcome?: DelegationRecordOutcome
  /** The report's opening line, for tooltips; the transcript holds the rest. */
  summary?: string
  completedAt?: number
  /** Whether the parent durably received the report, when tracked. */
  delivery?: DelegationRecordDelivery
}

const RECORD_VERSION = 2

export function sessionDelegationRecord(session: Session): DelegationRecordView | undefined {
  if (!session.parentID) return undefined
  const raw = rawDelegation(session)
  if (!raw) return undefined
  if (raw.version !== undefined) return decodeVersioned(raw, session.parentID)
  return decodeLegacy(raw)
}

/** The settled outcome, when one is honored. Running records report nothing. */
export function sessionDelegationOutcome(session: Session): DelegationRecordOutcome | undefined {
  const record = sessionDelegationRecord(session)
  return record?.phase === "settled" ? record.outcome : undefined
}

/** The report's opening line, stamped beside the outcome by the same record. */
export function sessionDelegationSummary(session: Session): string | undefined {
  return sessionDelegationRecord(session)?.summary
}

function rawDelegation(session: Session): Record<string, unknown> | undefined {
  const opencodex = session.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null) return undefined
  const delegation = (opencodex as { delegation?: unknown }).delegation
  if (typeof delegation !== "object" || delegation === null) return undefined
  return delegation as Record<string, unknown>
}

function isOutcome(value: unknown): value is DelegationRecordOutcome {
  return value === "completed" || value === "errored" || value === "cancelled" || value === "abandoned"
}

function isDelivery(value: unknown): value is DelegationRecordDelivery {
  return value === "pending" || value === "delivered" || value === "failed"
}

function decodeVersioned(raw: Record<string, unknown>, parentID: string): DelegationRecordView | undefined {
  if (raw.version !== RECORD_VERSION) return undefined
  if (typeof raw.runID !== "string" || !raw.runID) return undefined
  if (raw.phase !== "running" && raw.phase !== "settled") return undefined
  if (raw.outcome !== undefined && !isOutcome(raw.outcome)) return undefined
  if (raw.completedAt !== undefined && (typeof raw.completedAt !== "number" || !Number.isFinite(raw.completedAt)))
    return undefined
  // The identity gate: the record must describe this exact graph edge.
  if (typeof raw.parentSessionID !== "string" || raw.parentSessionID !== parentID) return undefined
  return {
    phase: raw.phase,
    ...(raw.outcome !== undefined ? { outcome: raw.outcome } : {}),
    ...(typeof raw.summary === "string" && raw.summary ? { summary: raw.summary } : {}),
    ...(typeof raw.completedAt === "number" ? { completedAt: raw.completedAt } : {}),
    ...(isDelivery(raw.deliveryOutcome) ? { delivery: raw.deliveryOutcome } : {}),
  }
}

/**
 * The pre-versioning stamp: `{ outcome, completedAt, summary? }` with
 * `succeeded`/`failed`/`cancelled`. Normalized into the current vocabulary; a
 * malformed timestamp is dropped rather than trusted.
 */
function decodeLegacy(raw: Record<string, unknown>): DelegationRecordView | undefined {
  const outcome =
    raw.outcome === "succeeded"
      ? ("completed" as const)
      : raw.outcome === "failed"
        ? ("errored" as const)
        : raw.outcome === "cancelled"
          ? ("cancelled" as const)
          : undefined
  if (!outcome) return undefined
  return {
    phase: "settled",
    outcome,
    ...(typeof raw.summary === "string" && raw.summary ? { summary: raw.summary } : {}),
    ...(typeof raw.completedAt === "number" && Number.isFinite(raw.completedAt)
      ? { completedAt: raw.completedAt }
      : {}),
  }
}
