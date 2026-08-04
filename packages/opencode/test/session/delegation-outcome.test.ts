import { describe, expect, test } from "bun:test"
import {
  DELEGATION_RECORD_VERSION,
  delegationAttempts,
  delegationOutcome,
  delegationRecord,
  delegationSummary,
  legacyDelegationOutcome,
  preserveDelegationRecord,
  settleDelegation,
  summarizeDelegationReport,
  withDelegationRecord,
  withoutDelegationRecord,
  type DelegationRecord,
} from "../../src/session/delegation-outcome"

function running(overrides: Partial<DelegationRecord> = {}): DelegationRecord {
  return {
    version: DELEGATION_RECORD_VERSION,
    runID: "run_1",
    parentSessionID: "ses_parent",
    attempt: 1,
    phase: "running",
    startedAt: 100,
    ...overrides,
  }
}

describe("delegation record metadata", () => {
  test("stamps a record while preserving the swarm bookkeeping beside it", () => {
    const metadata = { opencodex: { swarmID: "swm_1", swarmRole: "Researcher", swarmDepth: 2 } }
    const stamped = withDelegationRecord(metadata, running())
    expect(stamped.opencodex).toMatchObject({
      swarmID: "swm_1",
      swarmRole: "Researcher",
      swarmDepth: 2,
      delegation: { version: 2, runID: "run_1", phase: "running" },
    })
    expect(delegationRecord(stamped)).toMatchObject({ runID: "run_1", parentSessionID: "ses_parent", attempt: 1 })
    // Still running: no settled outcome to report.
    expect(delegationOutcome(stamped)).toBeUndefined()
  })

  test("stamps onto empty or missing metadata without inventing anything else", () => {
    const settled = settleDelegation(running(), { outcome: "errored", completedAt: 5 })
    expect(delegationOutcome(withDelegationRecord(undefined, settled))).toBe("errored")
    expect(delegationOutcome(withDelegationRecord({}, settleDelegation(running(), { outcome: "cancelled" })))).toBe(
      "cancelled",
    )
  })

  test("settling produces the terminal record from the running one", () => {
    const settled = settleDelegation(running(), {
      outcome: "completed",
      summary: "The fix landed.",
      completedAt: 200,
      deliveryOutcome: "pending",
    })
    expect(settled).toMatchObject({
      runID: "run_1",
      phase: "settled",
      outcome: "completed",
      completedAt: 200,
      deliveryOutcome: "pending",
    })
    const stamped = withDelegationRecord(undefined, settled)
    expect(delegationOutcome(stamped)).toBe("completed")
    expect(delegationSummary(stamped)).toBe("The fix landed.")
  })

  test("a later run's record replaces the previous one and renumbers the attempt", () => {
    const first = withDelegationRecord(undefined, settleDelegation(running(), { outcome: "errored" }))
    expect(delegationAttempts(first)).toBe(1)
    const second = withDelegationRecord(
      first,
      running({ runID: "run_2", attempt: delegationAttempts(first) + 1 }),
    )
    expect(delegationRecord(second)).toMatchObject({ runID: "run_2", attempt: 2, phase: "running" })
    // The old terminal outcome no longer shows while the new run works.
    expect(delegationOutcome(second)).toBeUndefined()
  })

  test("carries the report's opening as the summary, bounded and collapsed", () => {
    const stamp = (summary?: string) =>
      withDelegationRecord(undefined, settleDelegation(running(), { outcome: "completed", summary }))
    expect(delegationSummary(stamp("  The   fix\nlanded.  "))).toBe("The fix landed.")
    const long = stamp("word ".repeat(200))
    expect(delegationSummary(long)!.length).toBeLessThanOrEqual(283)
    expect(delegationSummary(long)!.endsWith("...")).toBe(true)
    // No summary is no key, not an empty string.
    expect(delegationSummary(stamp())).toBeUndefined()
    expect(JSON.stringify(stamp())).not.toContain(`"summary"`)
    expect(summarizeDelegationReport("   ")).toBeUndefined()
  })

  test("reads nothing from foreign or malformed shapes", () => {
    expect(delegationRecord(undefined)).toBeUndefined()
    expect(delegationRecord({})).toBeUndefined()
    expect(delegationRecord({ opencodex: "nope" })).toBeUndefined()
    // Unknown versions and enum values degrade to no record, never success.
    // Written as the stored shape rather than through the writer: this is
    // metadata that a future version - or a hand-edited session - can put on
    // disk, which the writer's own types would never let us build.
    expect(delegationRecord({ opencodex: { delegation: { ...running(), version: 3 } } })).toBeUndefined()
    expect(
      delegationRecord({ opencodex: { delegation: { ...running(), phase: "settled", outcome: "maybe" } } }),
    ).toBeUndefined()
    // Malformed timestamps are rejected rather than tolerated.
    expect(
      delegationRecord(withDelegationRecord(undefined, running({ startedAt: Number.NaN }))),
    ).toBeUndefined()
    expect(
      delegationRecord(
        withDelegationRecord(undefined, settleDelegation(running(), { outcome: "completed", completedAt: Number.NaN })),
      ),
    ).toBeUndefined()
  })

  test("still reads pre-versioning stamps, normalized to the current vocabulary", () => {
    const legacy = { opencodex: { delegation: { outcome: "succeeded", completedAt: 5, summary: "old report" } } }
    expect(legacyDelegationOutcome(legacy)).toBe("succeeded")
    expect(delegationRecord(legacy)).toBeUndefined()
    expect(delegationOutcome(legacy)).toBe("completed")
    expect(delegationSummary(legacy)).toBe("old report")
    expect(delegationAttempts(legacy)).toBe(1)
    expect(delegationOutcome({ opencodex: { delegation: { outcome: "failed", completedAt: 5 } } })).toBe("errored")
    expect(delegationOutcome({ opencodex: { delegation: { outcome: "cancelled", completedAt: 5 } } })).toBe(
      "cancelled",
    )
    expect(delegationOutcome({ opencodex: { delegation: { outcome: "maybe" } } })).toBeUndefined()
  })

  test("stripping removes the record and nothing else - what a fork must do", () => {
    const stamped = withDelegationRecord(
      { opencodex: { swarmID: "swm_1" }, other: true },
      settleDelegation(running(), { outcome: "completed" }),
    )
    const stripped = withoutDelegationRecord(stamped)
    expect(stripped).toEqual({ opencodex: { swarmID: "swm_1" }, other: true })
    expect(withoutDelegationRecord(undefined)).toBeUndefined()
    expect(withoutDelegationRecord({ plain: 1 })).toEqual({ plain: 1 })
  })

  test("a generic metadata replacement can neither erase nor forge the record", () => {
    const stored = withDelegationRecord({ note: "keep" }, settleDelegation(running(), { outcome: "completed" }))
    // The caller drops the delegation key entirely: the stored record survives.
    const erased = preserveDelegationRecord(stored, { note: "changed" })
    expect(delegationOutcome(erased)).toBe("completed")
    expect(erased.note).toBe("changed")
    // The caller sends its own delegation object: the stored record wins.
    const forged = preserveDelegationRecord(stored, {
      opencodex: { delegation: { version: 2, runID: "run_evil", parentSessionID: "x", attempt: 1, phase: "settled", outcome: "completed", startedAt: 1 } },
    })
    expect(delegationRecord(forged)?.runID).toBe("run_1")
    // No stored record: the caller cannot introduce one.
    const invented = preserveDelegationRecord({}, {
      opencodex: { delegation: { outcome: "succeeded", completedAt: 1 } },
    })
    expect(delegationOutcome(invented)).toBeUndefined()
  })
})
