import { describe, expect, test } from "bun:test"
import {
  subagentGraphNode,
  taskSubagentSessionID,
  transcriptSubagentClick,
} from "../src/renderer/src/lib/transcript-subagent-link"
import type { SessionGraph, SessionGraphNode } from "../src/renderer/src/lib/session-graph"

describe("transcript sub-agent links", () => {
  test("reads the child session off a task part's metadata for the whole run", () => {
    // The task tool stamps `sessionId` before the sub-agent starts, so a
    // running agent row is already addressable, not just a finished one.
    expect(taskSubagentSessionID("task", { sessionId: "ses_child" })).toBe("ses_child")
  })

  test("only the task tool links, and only with a real id", () => {
    expect(taskSubagentSessionID("bash", { sessionId: "ses_child" })).toBeUndefined()
    expect(taskSubagentSessionID("task", {})).toBeUndefined()
    expect(taskSubagentSessionID("task", { sessionId: "" })).toBeUndefined()
    expect(taskSubagentSessionID("task", { sessionId: 42 })).toBeUndefined()
  })

  test("resolves the drawn graph node so the click opens the same view as the canvas", () => {
    const graph = graphWith([
      node({ id: "session:root", sessionID: "root", root: true }),
      node({ id: "session:ses_child", sessionID: "ses_child" }),
      node({ id: "job:job-1", sessionID: "ses_child", kind: "job" }),
    ])
    expect(subagentGraphNode(graph, "ses_child")?.id).toBe("session:ses_child")
  })

  test("never resolves the root, a job, or an undiscovered child", () => {
    const graph = graphWith([node({ id: "session:root", sessionID: "root", root: true })])
    // The embedded pane closes itself for nodes the graph does not hold, so a
    // link that cannot resolve must fall through instead of flashing a pane.
    expect(subagentGraphNode(graph, "root")).toBeUndefined()
    expect(subagentGraphNode(graph, "ses_missing")).toBeUndefined()
    expect(subagentGraphNode(undefined, "ses_child")).toBeUndefined()
  })

  test("activates the same graph node from a transcript row", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Element")
    class TestElement extends EventTarget {
      closest(selector: string) {
        expect(selector).toBe("[data-subagent-session]")
        return { dataset: { subagentSession: "ses_child" } }
      }
    }
    Object.defineProperty(globalThis, "Element", { configurable: true, value: TestElement })
    try {
      const graph = graphWith([
        node({ id: "session:root", sessionID: "root", root: true }),
        node({ id: "session:ses_child", sessionID: "ses_child" }),
      ])
      let opened: SessionGraphNode | undefined
      let prevented = false
      const event = {
        target: new TestElement(),
        preventDefault: () => { prevented = true },
      }

      expect(transcriptSubagentClick(event, graph, (value) => { opened = value })).toBe(true)
      expect(opened?.id).toBe("session:ses_child")
      expect(prevented).toBe(true)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "Element", descriptor)
      else Reflect.deleteProperty(globalThis, "Element")
    }
  })
})

function node(overrides: Partial<SessionGraphNode> & { id: string }): SessionGraphNode {
  return {
    kind: "session",
    depth: 0,
    title: overrides.id,
    status: "running",
    statusLabel: "Running",
    updatedAt: 0,
    root: false,
    ...overrides,
  }
}

function graphWith(nodes: SessionGraphNode[]): SessionGraph {
  return {
    rootID: "session:root",
    rootSessionID: "root",
    nodes,
    edges: [],
    counts: {
      total: nodes.length,
      delegated: 0,
      running: 0,
      retrying: 0,
      queued: 0,
      blocked: 0,
      needsReview: 0,
      completed: 0,
      returned: 0,
      failed: 0,
      cancelled: 0,
    },
  }
}
