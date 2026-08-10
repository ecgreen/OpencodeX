import { describe, expect, test } from "bun:test"
import { createSidechainRouter } from "../../src/opencodex/claude-sidechain"
import type { MapperContext, MapperState } from "../../src/opencodex/claude-mapper"

let part = 0
let msg = 0
function makeContext(sessionID: string, parentMessageID: string): MapperContext {
  return {
    sessionID,
    parentMessageID,
    directory: ".",
    nextMessageID: () => `msg_${++msg}`,
    nextPartID: () => `prt_${++part}`,
    now: () => 1000,
    decidedInput: () => undefined,
  } as unknown as MapperContext
}

const mainToolParts = new Map([
  ["task_1", { partID: "prt_task", tool: "agent", input: { description: "Review the diff", prompt: "Please review", subagent_type: "code-reviewer" }, start: 1 }],
]) as unknown as MapperState["toolParts"]

const sidechainAssistant = {
  type: "assistant",
  parent_tool_use_id: "task_1",
  message: { id: "m_side", content: [{ type: "text", text: "child says hi" }] },
}

describe("sidechain router", () => {
  test("main events pass through untouched", () => {
    const router = createSidechainRouter({ makeContext })
    const result = router.route({ type: "assistant", message: { id: "m_main", content: [] } } as never, mainToolParts)
    expect(result.handled).toBe(false)
    expect(result.actions).toEqual([])
  })

  test("first sidechain event spawns a child titled from the Task call; writes buffer until attach", () => {
    const router = createSidechainRouter({ makeContext })
    const result = router.route(sidechainAssistant as never, mainToolParts)
    expect(result.handled).toBe(true)
    expect(result.actions).toEqual([{ kind: "spawn", chainID: "task_1", title: "Review the diff", prompt: "Please review" }])
    const flushed = router.attachChild("task_1", "ses_child", "msg_user_child")
    const writeActions = flushed.flatMap((a) => (a.kind === "writes" ? [a] : []))
    expect(writeActions[0]?.sessionID).toBe("ses_child")
    const texts = writeActions.flatMap((a) => a.writes).filter((w) => w.kind === "part").map((w) => (w as { part: { text?: string } }).part.text)
    expect(texts).toContain("child says hi")
  })

  test("unknown Task call falls back to a generic title", () => {
    const router = createSidechainRouter({ makeContext })
    const result = router.route({ ...sidechainAssistant, parent_tool_use_id: "task_unknown" } as never, mainToolParts)
    expect(result.actions[0]).toMatchObject({ kind: "spawn", title: "Claude subagent" })
  })

  test("the spawning call's tool_result finalizes the chain (event still reaches the main mapper)", () => {
    const router = createSidechainRouter({ makeContext })
    router.route(sidechainAssistant as never, mainToolParts)
    router.attachChild("task_1", "ses_child", "msg_user_child")
    // leave a tool running inside the child so finalize has something to close
    router.route({
      type: "assistant",
      parent_tool_use_id: "task_1",
      message: { id: "m_side", content: [{ type: "tool_use", id: "inner_1", name: "Read", input: { file_path: "x" } }] },
    } as never, mainToolParts)
    const settle = router.route({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "task_1", content: [{ type: "text", text: "done" }] }] },
    } as never, mainToolParts)
    expect(settle.handled).toBe(false) // main mapper still records the Task tool result
    const writes = settle.actions.filter((a) => a.kind === "writes").flatMap((a) => (a.kind === "writes" ? a.writes : []))
    expect(writes.length).toBeGreaterThan(0) // the interrupted inner tool was closed
  })

  test("finalizeAll closes chains the turn abandoned", () => {
    const router = createSidechainRouter({ makeContext })
    router.route(sidechainAssistant as never, mainToolParts)
    router.attachChild("task_1", "ses_child", "msg_user_child")
    const actions = router.finalizeAll()
    expect(actions.every((a) => a.kind === "writes" && a.sessionID === "ses_child")).toBe(true)
  })
})
