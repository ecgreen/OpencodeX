import { describe, expect, test } from "bun:test"
import {
  emptyClientSessionOrderState,
  clientSessionOrderBucketForStatus,
  orderClientSessionItems,
  priorClientSessionItems,
  projectClientSessionItems,
  recentClientSessionItems,
  reconcileClientSessionOrderState,
  type ClientSessionOrderBucket,
  type ClientSessionOrderInput,
} from "../src/v2/session-order"

describe("client session ordering", () => {
  test("orders buckets before inactive recency", () => {
    const items = [
      item("inactive-new", "inactive", 90),
      item("progress", "in_progress", 40),
      item("review", "ready_for_review", 30),
      item("feedback", "input_needed", 20),
      item("inactive-old", "inactive", 1),
    ]
    const state = reconcileClientSessionOrderState(emptyClientSessionOrderState(), items)

    expect(orderClientSessionItems(items, state).map((entry) => entry.id)).toEqual([
      "feedback",
      "review",
      "progress",
      "inactive-new",
      "inactive-old",
    ])
  })

  test("maps GUI and TUI status labels into shared buckets", () => {
    expect(clientSessionOrderBucketForStatus("input_needed")).toBe("input_needed")
    expect(clientSessionOrderBucketForStatus("needs_review")).toBe("ready_for_review")
    expect(clientSessionOrderBucketForStatus("review_ready")).toBe("ready_for_review")
    expect(clientSessionOrderBucketForStatus("unviewed")).toBe("ready_for_review")
    expect(clientSessionOrderBucketForStatus("in_progress")).toBe("in_progress")
    expect(clientSessionOrderBucketForStatus("dormant")).toBe("inactive")
  })

  test("keeps non-idle sessions stable when timestamps change", () => {
    const initial = [
      item("first", "in_progress", 10),
      item("second", "in_progress", 20),
    ]
    const state = reconcileClientSessionOrderState(emptyClientSessionOrderState(), initial)
    const updated = [
      item("second", "in_progress", 200),
      item("first", "in_progress", 10),
    ]
    const nextState = reconcileClientSessionOrderState(state, updated)

    expect(orderClientSessionItems(updated, nextState).map((entry) => entry.id)).toEqual(["first", "second"])
  })

  test("moves new bucket entrants to the top of their bucket", () => {
    const state = reconcileClientSessionOrderState(emptyClientSessionOrderState(), [
      item("old", "ready_for_review", 10),
    ])
    const next = [
      item("old", "ready_for_review", 10),
      item("new", "ready_for_review", 100),
    ]

    expect(orderClientSessionItems(next, reconcileClientSessionOrderState(state, next)).map((entry) => entry.id)).toEqual([
      "new",
      "old",
    ])
  })

  test("prunes inactive sessions and re-enters them as new active rows", () => {
    const active = [item("review", "ready_for_review", 10)]
    const activeState = reconcileClientSessionOrderState(emptyClientSessionOrderState(), active)
    const inactiveState = reconcileClientSessionOrderState(activeState, [item("review", "inactive", 20)])
    const next = [item("review", "ready_for_review", 30), item("older", "ready_for_review", 1)]
    const nextState = reconcileClientSessionOrderState(
      reconcileClientSessionOrderState(inactiveState, [item("older", "ready_for_review", 1)]),
      next,
    )

    expect(inactiveState.entries.review).toBeUndefined()
    expect(orderClientSessionItems(next, nextState).map((entry) => entry.id)).toEqual(["review", "older"])
  })

  test("splits recent and prior sessions with active sessions always recent", () => {
    const now = 20_000_000
    const items = [
      item("running-old", "in_progress", 1),
      item("idle-recent", "inactive", 19_999_000),
      item("idle-prior", "inactive", 2),
    ]
    const state = reconcileClientSessionOrderState(emptyClientSessionOrderState(), items)

    expect(recentClientSessionItems(items, state, now).map((entry) => entry.id)).toEqual(["running-old", "idle-recent"])
    expect(priorClientSessionItems(items, state, now).map((entry) => entry.id)).toEqual(["idle-prior"])
  })

  test("uses ordered active rows before filling project previews with inactive sessions", () => {
    const now = 1_000_000_000
    const items = [
      item("idle-new", "inactive", 900),
      item("review", "ready_for_review", 10),
      item("running", "in_progress", 20),
      item("idle-old", "inactive", 1),
    ]
    const state = reconcileClientSessionOrderState(emptyClientSessionOrderState(), items)

    expect(projectClientSessionItems(items, state, now).map((entry) => entry.id)).toEqual([
      "review",
      "running",
      "idle-new",
      "idle-old",
    ])
  })
})

function item(id: string, bucket: ClientSessionOrderBucket, timeUpdated: number): ClientSessionOrderInput {
  return {
    id,
    bucket,
    timeUpdated,
    timeCreated: timeUpdated,
  }
}
