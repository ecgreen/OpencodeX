import { describe, expect, test } from "bun:test"
import {
  emptyClientSessionOrderState,
  reconcileClientSessionOrderState,
  type ClientSessionOrderBucket,
  type ClientSessionOrderInput,
} from "@opencode-ai/sdk/v2/session-order"
import { recentProjectItems } from "../../../../src/cli/cmd/tui/component/opencodex-session-recency"

describe("opencodex session recency", () => {
  test("uses shared stable ordering for project previews", () => {
    const items = [
      item("running", "in_progress", 10),
      item("review", "ready_for_review", 20),
      item("idle-new", "inactive", 30),
      item("idle-old", "inactive", 1),
    ]
    const state = reconcileClientSessionOrderState(emptyClientSessionOrderState(), items)

    expect(recentProjectItems(items, state, 20_000_000).map((entry) => entry.id)).toEqual([
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
