import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { createSidechainRouter, recoverSpawnFailure } from "../../src/opencodex/claude-sidechain"
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

  test("a tool_progress heartbeat for a long-running main tool call does not spawn a phantom subagent", () => {
    // The CLI emits `tool_progress` heartbeat frames for any tool call running
    // longer than ~30s (e.g. the swarm delegate MCP tool), tagged with
    // parent_tool_use_id = the running call's OWN id. That is progress
    // telemetry, not a subagent conversation - spawning a chain for it
    // manufactures an empty "Claude subagent" child session.
    const router = createSidechainRouter({ makeContext })
    const result = router.route(
      {
        type: "tool_progress",
        tool_use_id: "task_1-heartbeat-0",
        tool_name: "mcp__opencodex_swarm__delegate",
        parent_tool_use_id: "task_1",
        elapsed_time_seconds: 30,
        heartbeat: true,
      } as never,
      mainToolParts,
    )
    expect(result.handled).toBe(true)
    expect(result.actions).toEqual([])
    // No chain was created: a later real sidechain event for the same call
    // must still spawn normally.
    const real = router.route(sidechainAssistant as never, mainToolParts)
    expect(real.actions[0]).toMatchObject({ kind: "spawn", chainID: "task_1" })
  })

  test("a tool_progress frame inside an existing chain is swallowed without buffering", () => {
    const router = createSidechainRouter({ makeContext })
    router.route(sidechainAssistant as never, mainToolParts)
    const progress = router.route(
      {
        type: "tool_progress",
        tool_use_id: "inner_1",
        tool_name: "Read",
        parent_tool_use_id: "task_1",
        elapsed_time_seconds: 30,
        heartbeat: true,
      } as never,
      mainToolParts,
    )
    expect(progress.handled).toBe(true)
    expect(progress.actions).toEqual([])
    // Attaching still flushes only the buffered conversation event.
    const flushed = router.attachChild("task_1", "ses_child", "msg_user_child")
    const texts = flushed
      .flatMap((a) => (a.kind === "writes" ? a.writes : []))
      .filter((w) => w.kind === "part")
      .map((w) => (w as { part: { text?: string } }).part.text)
    expect(texts).toContain("child says hi")
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

  test("a background agent's launch ack does not finalize the chain; the completion notification does", () => {
    // Background subagents (the SDK default) return their Task tool_result
    // immediately - "Async agent launched successfully" - while the agent
    // keeps streaming sidechain events. Settling the chain on that ack froze
    // the child transcript at birth and dropped everything the agent did.
    const router = createSidechainRouter({ makeContext })
    // The CLI announces the background launch before the ack tool_result.
    const started = router.route(
      { type: "system", subtype: "task_started", task_id: "bg1", tool_use_id: "task_1" } as never,
      mainToolParts,
    )
    expect(started.handled).toBe(false) // main mapper still sees system events
    router.route(sidechainAssistant as never, mainToolParts)
    router.attachChild("task_1", "ses_child", "msg_user_child")
    // The launch ack must NOT settle the chain.
    const ack = router.route(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "task_1", content: [{ type: "text", text: "Async agent launched successfully." }] }] },
      } as never,
      mainToolParts,
    )
    expect(ack.handled).toBe(false)
    expect(ack.actions).toEqual([])
    // The agent's later output still lands in the child session.
    const late = router.route(
      { type: "assistant", parent_tool_use_id: "task_1", message: { id: "m_side2", content: [{ type: "text", text: "late output" }] } } as never,
      mainToolParts,
    )
    const lateTexts = late.actions
      .flatMap((a) => (a.kind === "writes" ? a.writes : []))
      .flatMap((w) => (w.kind === "part" && w.part.type === "text" ? [w.part.text] : []))
    expect(lateTexts).toContain("late output")
    // The completion notification settles the chain.
    const settle = router.route(
      { type: "system", subtype: "task_notification", task_id: "bg1", tool_use_id: "task_1", status: "completed" } as never,
      mainToolParts,
    )
    expect(settle.handled).toBe(false)
    const stepFinish = settle.actions
      .flatMap((a) => (a.kind === "writes" ? a.writes : []))
      .find((w) => w.kind === "part" && w.part.type === "step-finish")
    expect(stepFinish).toMatchObject({ part: { reason: "subagent completed" } })
    // Nothing left for the end-of-turn sweep to close.
    expect(router.finalizeAll()).toEqual([])
  })

  test("a failed background agent settles its chain with a failure reason", () => {
    const router = createSidechainRouter({ makeContext })
    router.route({ type: "system", subtype: "task_started", task_id: "bg1", tool_use_id: "task_1" } as never, mainToolParts)
    router.route(sidechainAssistant as never, mainToolParts)
    router.attachChild("task_1", "ses_child", "msg_user_child")
    const settle = router.route(
      { type: "system", subtype: "task_notification", task_id: "bg1", tool_use_id: "task_1", status: "failed" } as never,
      mainToolParts,
    )
    const stepFinish = settle.actions
      .flatMap((a) => (a.kind === "writes" ? a.writes : []))
      .find((w) => w.kind === "part" && w.part.type === "step-finish")
    expect(stepFinish).toMatchObject({ part: { reason: "subagent failed" } })
  })

  test("finalizeAll closes chains the turn abandoned", () => {
    const router = createSidechainRouter({ makeContext })
    router.route(sidechainAssistant as never, mainToolParts)
    router.attachChild("task_1", "ses_child", "msg_user_child")
    const actions = router.finalizeAll()
    expect(actions.every((a) => a.kind === "writes" && a.sessionID === "ses_child")).toBe(true)
  })

  test("finalizeAll threads a custom reason into the closed turn's step-finish part", () => {
    const router = createSidechainRouter({ makeContext })
    router.route(sidechainAssistant as never, mainToolParts)
    router.attachChild("task_1", "ses_child", "msg_user_child")
    const actions = router.finalizeAll("The turn was interrupted before this subagent finished.")
    const stepFinish = actions
      .filter((a) => a.kind === "writes")
      .flatMap((a) => (a.kind === "writes" ? a.writes : []))
      .find((w) => w.kind === "part" && w.part.type === "step-finish")
    expect(stepFinish).toMatchObject({
      kind: "part",
      part: { type: "step-finish", reason: "The turn was interrupted before this subagent finished." },
    })
  })

  test("abandonChain marks a spawn-failed chain done so later events for it are dropped, not buffered", () => {
    const router = createSidechainRouter({ makeContext })
    // Spawn is requested but never attached (as happens when the controller's
    // spawn recovery yields undefined).
    router.route(sidechainAssistant as never, mainToolParts)
    router.abandonChain("task_1")
    // A later event for the same chain must not buffer into `pending` forever.
    const result = router.route(
      { type: "assistant", parent_tool_use_id: "task_1", message: { id: "m_side", content: [{ type: "text", text: "more" }] } } as never,
      mainToolParts,
    )
    expect(result.actions).toEqual([])
    // finalizeAll must not try to close an already-abandoned chain again.
    expect(router.finalizeAll()).toEqual([])
  })
})

// A spawn failure must not kill the main turn - it must be recovered into
// `undefined` so the driver just skips that one sidechain. `spawn`'s declared
// error channel is `never` (callers `Effect.orDie` their own errors, e.g.
// prompt-swarm.ts's `sessions.create`/`prompt`), so a real failure surfaces
// as a DEFECT, not a typed error. A handler that only inspects the typed
// error channel (`Effect.catch`/`Effect.catchAll`) never runs for a defect,
// so it is dead code here - the defect sails through unrecovered, killing
// `interpretSidechainActions`, the driver's consume loop, and the whole turn
// before `finalize`/`saveConversation` run. These tests pin the actual
// recovery behavior `recoverSpawnFailure` must provide; the die/typed-error
// cases below fail if `recoverSpawnFailure` is reimplemented as a plain
// `Effect.catch` (a rejected promise instead of resolving to `undefined`).
describe("recoverSpawnFailure", () => {
  test("a spawn that dies (Effect.orDie's failure mode) recovers to undefined instead of propagating", async () => {
    const dying = Effect.die(new Error("simulated spawn crash")) as Effect.Effect<
      { sessionID: string; userMessageID: string },
      never
    >
    const result = await Effect.runPromise(recoverSpawnFailure(dying))
    expect(result).toBeUndefined()
  })

  test("a spawn that fails with a typed error also recovers instead of propagating", async () => {
    // spawn's declared type says E = never, but a defensive recovery must
    // not rely on that promise holding for every future caller.
    const failing = Effect.fail("boom") as unknown as Effect.Effect<{ sessionID: string; userMessageID: string }, never>
    const result = await Effect.runPromise(recoverSpawnFailure(failing))
    expect(result).toBeUndefined()
  })

  test("a successful spawn passes through untouched", async () => {
    const ok = Effect.succeed({ sessionID: "ses_1", userMessageID: "msg_1" })
    const result = await Effect.runPromise(recoverSpawnFailure(ok))
    expect(result).toEqual({ sessionID: "ses_1", userMessageID: "msg_1" })
  })

  test("does NOT swallow genuine fiber interruption - the turn must still be able to stop", async () => {
    const interrupted = Effect.interrupt as unknown as Effect.Effect<
      { sessionID: string; userMessageID: string },
      never
    >
    const exit = await Effect.runPromiseExit(recoverSpawnFailure(interrupted))
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
  })
})
