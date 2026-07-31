import { describe, expect, test } from "bun:test"
import type { OpencodeXJob, Session } from "../src/v2/client"
import { clientAttentionItems, clientAttentionTransitions, clientWorkItemBucket, clientWorkItems, createClientWorkItemSelector, type AttentionItem, type WorkItemProjectionInput } from "../src/v2/work-item"

describe("shared work item projection", () => {
  test("projects session and job lifecycle without duplicating state owners", () => {
    const items = clientWorkItems(state(), 5_000)
    const session = items.find((item) => item.id === "session:session-1")
    const job = items.find((item) => item.id === "job:job-1")

    expect(session).toMatchObject({ state: "waiting_permission", blocker: "edit", executionTarget: { kind: "worktree" } })
    expect(job).toMatchObject({ state: "cancelling", parentID: "session:session-1" })
    expect(clientWorkItemBucket(session)).toBe("input_needed")
  })

  test("orders actionable work before review items", () => {
    const attention = clientAttentionItems(clientWorkItems(state(), 5_000))

    expect(attention.map((item) => item.kind)).toEqual(["permission"])
    expect(attention[0]?.workItemID).toBe("session:session-1")
  })

  test("reports only newly appeared attention items", () => {
    const permission = attention("permission:session:session-1")
    const failure = attention("failure:job:job-1")

    expect(clientAttentionTransitions([], [permission, failure])).toEqual([permission, failure])
    expect(clientAttentionTransitions([permission], [permission, failure])).toEqual([failure])
    expect(clientAttentionTransitions([permission, failure], [permission, failure])).toEqual([])
    expect(clientAttentionTransitions([permission, failure], [])).toEqual([])
    // A resolved item returning later is new again, so the reader is told twice.
    expect(clientAttentionTransitions([failure], [permission])).toEqual([permission])
  })

  test("retains projection identity when transcript-only state changes", () => {
    const input = state()
    const select = createClientWorkItemSelector()
    const first = select(input)
    expect(select({ ...input })).toBe(first)
    expect(select({ ...input, sessionStatus: { ...input.sessionStatus } })).not.toBe(first)
  })
})

function attention(id: string): AttentionItem {
  return {
    id,
    workItemID: id.split(":").slice(1).join(":"),
    kind: "permission",
    priority: 0,
    title: id,
    detail: "",
    state: "waiting_permission",
    updatedAt: 1_000,
  }
}

function state(): WorkItemProjectionInput {
  const session = {
    id: "session-1",
    slug: "session-1",
    projectID: "project-1",
    directory: "C:/repo",
    title: "Implement feature",
    version: "1",
    metadata: { executionTarget: "worktree", worktreePath: "C:/repo-worktree" },
    time: { created: 1_000, updated: 2_000 },
  } satisfies Session
  const job = {
    id: "job-1",
    kind: "session.task",
    title: "Implement feature",
    status: "running",
    source: "manual",
    projectID: "project-1",
    sessionID: "session-1",
    attempt: 1,
    maxAttempts: 3,
    cancelRequestedAt: 2_500,
    timeCreated: 1_000,
    timeUpdated: 3_000,
  } satisfies OpencodeXJob
  return {
    sessions: { ids: [session.id], records: { [session.id]: session } },
    sessionStatus: { [session.id]: { type: "idle" } },
    sessionUiState: {},
    permissions: { ids: ["permission-1"], records: { "permission-1": { id: "permission-1", sessionID: session.id, permission: "edit", patterns: [], metadata: {}, always: [] } } },
    questions: { ids: [], records: {} },
    jobs: { ids: [job.id], records: { [job.id]: job } },
  }
}
