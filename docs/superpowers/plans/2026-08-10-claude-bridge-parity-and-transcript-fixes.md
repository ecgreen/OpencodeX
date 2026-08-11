# Claude Bridge Parity & Transcript Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude-driven sessions gain todo-widget rendering, correct queued-message delivery, a pinned fix for transcript doubling, subagent child sessions (populating the session graph), and single-line tool rows.

**Architecture:** Four independent fixes plus a regression pin, all in the Claude bridge (`packages/opencode/src/opencodex/claude-*`), the session prompt loop (`packages/opencode/src/session/`), and one GUI stylesheet. The mapper gains a task registry that feeds the existing `{ kind: "todos" }` write; the prompt loop threads each queued command's own message; a new pure sidechain router turns `parent_tool_use_id` streams into real child sessions; CSS stops tool-header flex wrapping.

**Tech Stack:** TypeScript, Effect (session services), bun test, SolidJS GUI (CSS only).

**Spec:** `docs/superpowers/specs/2026-08-10-claude-bridge-parity-and-transcript-fixes-design.md`

## Global Constraints

- OpenAI/native provider paths must be untouched — they already work.
- Task-tool → todo mapping uses the EXISTING `SessionWrite` `{ kind: "todos", todos }` (claude-mapper.ts:48) and the existing GUI surfaces; no GUI component changes for feature 1.
- Status vocabulary passes through verbatim: `pending` / `in_progress` / `completed`; `deleted` removes the task.
- Sidechain limitations are accepted per spec: cost/tokens stay on the main session; nested sidechains parent to the main session.
- Run opencode unit tests from `packages/opencode`: `cd packages/opencode && bun test test/opencodex/<file>.test.ts`
- Typecheck: `cd packages/opencode && bun run typecheck` (and `cd packages/gui && bun run typecheck` for GUI changes).
- Commits run a staged design-system hook automatically; fix causes, never bypass hooks.
- The working tree carries unrelated uncommitted changes; stage ONLY files this plan names.

---

### Task 1: Map Claude task tools into the built-in todo system

**Files:**
- Modify: `packages/opencode/src/opencodex/claude-mapper.ts` (MapperState ~line 77, `initialState` ~line 90, `mapToolResult` line 376)
- Modify: `packages/opencode/src/opencodex/claude-driver-metadata.ts` (Conversation type line 11, `readConversation` line 30)
- Modify: `packages/opencode/src/opencodex/claude-driver.ts` (`initialState` call ~line 138, `saveConversation` ~line 205)
- Test: `packages/opencode/test/opencodex/claude-mapper.test.ts`

**Interfaces:**
- Consumes: existing `SessionWrite` variant `{ kind: "todos"; todos: Array<{ content: string; status: string; priority?: string }> }`; `mapToolResult`'s `pending = state.toolParts.get(callID)` giving `{ tool, input }`; `readResultText(block.content)` giving the result text.
- Produces:
  - `MapperState.tasks: Map<string, { subject: string; status: string }>`
  - `initialState(input: { modelID?; billed?; tasks?: ConversationTask[] })`
  - `ConversationTask = { id: string; subject: string; status: string }` exported from `claude-driver-metadata.ts`, and `Conversation.tasks?: ConversationTask[]`
  - `taskRegistryTodos(state: MapperState): Array<{ content: string; status: string }>` (exported for the driver's save step and tests)

- [ ] **Step 1: Write the failing tests**

Append to `packages/opencode/test/opencodex/claude-mapper.test.ts` (reuse the file's existing `context()` helper and event-feeding style; `run` below means the file's pattern of folding `mapEvent` over events and collecting writes):

```ts
describe("task tools feed the todo system", () => {
  function toolTurn(tool: string, input: Record<string, unknown>, resultText: string) {
    return [
      { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: `call_${tool}`, name: tool, input }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `call_${tool}`, content: [{ type: "text", text: resultText }] }] } },
    ] as ClaudeEvent[]
  }

  test("taskcreate registers a pending todo and emits the todos write", () => {
    const { writes } = run([
      ...toolTurn("TaskCreate", { subject: "Fix login", description: "d" }, "Task #1 created successfully: Fix login"),
    ])
    const todos = writes.filter((w) => w.kind === "todos").at(-1)
    expect(todos).toMatchObject({ kind: "todos", todos: [{ content: "Fix login", status: "pending" }] })
  })

  test("taskupdate changes status; deleted removes; unknown id is ignored", () => {
    const { writes } = run([
      ...toolTurn("TaskCreate", { subject: "Fix login" }, "Task #1 created successfully: Fix login"),
      ...toolTurn("TaskUpdate", { taskId: "1", status: "in_progress" }, "Updated task #1 status"),
      ...toolTurn("TaskUpdate", { taskId: "99", status: "completed" }, "no such task"),
      ...toolTurn("TaskUpdate", { taskId: "1", status: "deleted" }, "deleted"),
    ])
    const lists = writes.filter((w) => w.kind === "todos").map((w) => w.todos)
    expect(lists.at(0)).toEqual([{ content: "Fix login", status: "pending" }])
    expect(lists.at(1)).toEqual([{ content: "Fix login", status: "in_progress" }])
    expect(lists.at(-1)).toEqual([])
    // the unknown-id update emitted no todos write
    expect(lists.length).toBe(3)
  })

  test("taskcreate result without a parseable id falls back to a local id", () => {
    const { writes, state } = run([
      ...toolTurn("TaskCreate", { subject: "A" }, "ok"),
      ...toolTurn("TaskCreate", { subject: "B" }, "ok"),
    ])
    expect([...state.tasks.keys()]).toEqual(["local-1", "local-2"])
  })

  test("completed task-tool parts carry metadata.todos for the transcript widget", () => {
    const { writes } = run([
      ...toolTurn("TaskCreate", { subject: "Fix login" }, "Task #1 created successfully: Fix login"),
    ])
    const part = writes.filter((w) => w.kind === "part").map((w) => w.part).findLast((p) => p.type === "tool")
    expect(part?.state).toMatchObject({ status: "completed", metadata: { todos: [{ content: "Fix login", status: "pending" }] } })
  })

  test("tasks seed from a prior turn's registry", () => {
    const state = initialState({ tasks: [{ id: "1", subject: "Fix login", status: "in_progress" }] })
    const { writes } = run([
      ...toolTurn("TaskUpdate", { taskId: "1", status: "completed" }, "Updated"),
    ], state)
    const todos = writes.filter((w) => w.kind === "todos").at(-1)
    expect(todos?.todos).toEqual([{ content: "Fix login", status: "completed" }])
  })
})
```

Note: `normalizeToolName` lowercases harness names — `TaskCreate` arrives as tool `taskcreate`. If the existing test file's `run` helper doesn't return `state`, extend it to return the final state.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/opencodex/claude-mapper.test.ts`
Expected: FAIL — no todos writes for task tools / `tasks` not on state.

- [ ] **Step 3: Implement the mapper side**

In `packages/opencode/src/opencodex/claude-mapper.ts`:

Add to `MapperState` (after `textParts`):

```ts
  /** Claude harness task tools (TaskCreate/TaskUpdate) projected as todos. */
  tasks: Map<string, { subject: string; status: string }>
```

Extend `initialState` (import `ConversationTask` type from `./claude-driver-metadata`):

```ts
export function initialState(input: { modelID?: string; billed?: MapperState["billed"]; tasks?: ConversationTask[] }): MapperState {
  return {
    ...
    tasks: new Map((input.tasks ?? []).map((task) => [task.id, { subject: task.subject, status: task.status }])),
  }
}
```

Every `next: MapperState = { ...state, toolParts: new Map(...), textParts: new Map(...), streamText: new Map(...) }` clone (there are four: `mapEvent`, `finalizeAbandonedTurn`, `startTurn`, and any added later) also clones `tasks: new Map(state.tasks)`.

Add helpers near `mapToolResult`:

```ts
export function taskRegistryTodos(state: MapperState) {
  return [...state.tasks.values()].map((task) => ({ content: task.subject, status: task.status }))
}

/** Applies a completed task tool to the registry. Returns the projected todos when the registry changed. */
function applyTaskTool(tool: string, input: Record<string, unknown>, output: string, state: MapperState) {
  if (tool === "taskcreate") {
    const parsed = /Task #(\w+) created/.exec(output)?.[1]
    const id = parsed ?? `local-${state.tasks.size + 1}`
    const subject = typeof input.subject === "string" && input.subject ? input.subject : "Task"
    state.tasks.set(id, { subject, status: "pending" })
    return taskRegistryTodos(state)
  }
  if (tool === "taskupdate") {
    const id = typeof input.taskId === "string" ? input.taskId : typeof input.taskId === "number" ? String(input.taskId) : undefined
    const current = id ? state.tasks.get(id) : undefined
    if (!id || !current) return undefined
    const status = typeof input.status === "string" && input.status ? input.status : current.status
    if (status === "deleted") state.tasks.delete(id)
    else
      state.tasks.set(id, {
        subject: typeof input.subject === "string" && input.subject ? input.subject : current.subject,
        status,
      })
    return taskRegistryTodos(state)
  }
  return undefined
}
```

In `mapToolResult` (line 376): after computing `input`/`output` and before building the part write, apply the registry on success and thread the todos into the completed metadata; after pushing the part write, push the todos write:

```ts
  const todos = block.is_error ? undefined : applyTaskTool(pending.tool, input, output, state)
  ...
        : {
            status: "completed",
            input,
            output,
            title: pending.tool,
            metadata: { ...completedMetadata(pending.tool, output), ...(todos ? { todos } : {}) },
            time: { start: pending.start, end },
          },
  ...
  if (todos) writes.push({ kind: "todos", todos })
```

- [ ] **Step 4: Persist the registry across turns**

In `packages/opencode/src/opencodex/claude-driver-metadata.ts`:

```ts
export type ConversationTask = { id: string; subject: string; status: string }
```

Add `tasks?: ConversationTask[]` to `Conversation` (line 11 block). In `readConversation`, validate and pass through:

```ts
    ...(Array.isArray(value.tasks) ? { tasks: value.tasks.filter(isTask) } : {}),
```

with:

```ts
function isTask(value: unknown): value is ConversationTask {
  return record(value) && typeof value.id === "string" && typeof value.subject === "string" && typeof value.status === "string"
}
```

In `packages/opencode/src/opencodex/claude-driver.ts`:

- `initialState` call (~line 138): add `tasks: conversation?.tasks`.
- `saveConversation` (~line 205): where the conversation object is written via `ClaudeDriverMetadata.withConversation`, include
  `...(live.tasks.size > 0 ? { tasks: [...live.tasks].map(([id, task]) => ({ id, ...task })) } : {})`
  (match the surrounding style — the function already spreads optional fields like `conversationID`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/opencodex/claude-mapper.test.ts`
Expected: PASS (all new + existing tests).

- [ ] **Step 6: Typecheck and commit**

Run: `cd packages/opencode && bun run typecheck`

```bash
git add packages/opencode/src/opencodex/claude-mapper.ts packages/opencode/src/opencodex/claude-driver-metadata.ts packages/opencode/src/opencodex/claude-driver.ts packages/opencode/test/opencodex/claude-mapper.test.ts
git commit -m "feat(claude-bridge): project TaskCreate/TaskUpdate into the built-in todo system"
```

---

### Task 2: Pin the doubling fix with a real-shape regression test

**Files:**
- Modify: `packages/opencode/test/opencodex/claude-mapper.test.ts`
- Modify: `DEV_README.md` (append an operator note)

**Interfaces:**
- Consumes: `initialState`, `mapEvent` from claude-mapper.
- Produces: nothing new — a pinned test.

- [ ] **Step 1: Write the regression test (expected to PASS already — it pins current behavior)**

Append to `packages/opencode/test/opencodex/claude-mapper.test.ts`. These shapes were captured from a live SDK trace on 2026-08-10: the CLI emits one `assistant` event per content block, blocks carry NO `index` field, and final thinking arrives stripped to empty:

```ts
test("regression: per-block no-index finals do not duplicate streamed parts", () => {
  const events = [
    { type: "stream_event", event: { type: "message_start", message: { id: "msg_real" } } },
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Pondering deeply" } } },
    // final thinking: stripped to empty, single block, no index field
    { type: "assistant", message: { id: "msg_real", content: [{ type: "thinking", thinking: "" }] } },
    { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
    { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "text" } } },
    { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "alpha and " } } },
    { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "more prose" } } },
    // final text: full content, single block, no index field (position 0 ≠ stream index 1)
    { type: "assistant", message: { id: "msg_real", content: [{ type: "text", text: "alpha and more prose" }] } },
  ] as ClaudeEvent[]
  const { writes } = run(events)
  const ids = new Map<string, string>()
  for (const w of writes) {
    if (w.kind === "part" && (w.part.type === "text" || w.part.type === "reasoning")) ids.set(w.part.id, w.part.type)
  }
  expect([...ids.values()].sort()).toEqual(["reasoning", "text"])
})
```

- [ ] **Step 2: Run and verify it passes**

Run: `cd packages/opencode && bun test test/opencodex/claude-mapper.test.ts`
Expected: PASS. If it FAILS, stop — that means the mapper regressed; do not weaken the test.

- [ ] **Step 3: Add the operator note**

Append to `DEV_README.md`:

```markdown
## Claude bridge changes require a coordinator restart

The GUI reuses an already-running coordinator (`gui-coordinator.ts`) across app
restarts. Changes to `packages/opencode` (mapper, driver, session loop) only
take effect when that process restarts — quitting the GUI is not enough. Kill
the `bun run … gui-coordinator.ts` process (or run the packaged updater); the
next GUI connection respawns it from current source.
```

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/test/opencodex/claude-mapper.test.ts DEV_README.md
git commit -m "test(claude-bridge): pin streamed/final dedup against real per-block event shapes"
```

---

### Task 3: Deliver each queued message, not the newest one N times

**Files:**
- Modify: `packages/opencode/src/session/prompt-schema.ts:41-43` (`LoopInput`)
- Modify: `packages/opencode/src/session/prompt-claim.ts:174` (loop call)
- Modify: `packages/opencode/src/session/prompt.ts:722-730` (`loop`)
- Modify: `packages/opencode/src/session/prompt-swarm.ts:246-272` (`claudeCodeTurn`)
- Test: `packages/opencode/test/opencodex/claude-turn-message.test.ts` (new)

**Interfaces:**
- Consumes: `SessionCommandTable.message_id` (available as `command.message_id` in prompt-claim); `lastUserMessage(sessionID)` in prompt-swarm.
- Produces:
  - `LoopInput` gains `messageID: Schema.optional(MessageID)`
  - `claudeCodeTurn(sessionID: SessionID, messageID?: MessageID)`
  - Pure helper `claudeTurnMessage<T extends { info: { id: string; role: string } }>(messages: readonly T[], messageID: string | undefined): T | undefined` exported from `prompt-swarm.ts`

- [ ] **Step 1: Write the failing test for the pure selection helper**

Create `packages/opencode/test/opencodex/claude-turn-message.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { claudeTurnMessage } from "../../src/session/prompt-swarm"

const messages = [
  { info: { id: "msg_1", role: "user" } },
  { info: { id: "msg_2", role: "assistant" } },
  { info: { id: "msg_3", role: "user" } }, // queued while a turn ran
  { info: { id: "msg_4", role: "user" } }, // queued later; the "last" one
]

describe("claudeTurnMessage", () => {
  test("returns the command's own message when a messageID is given", () => {
    expect(claudeTurnMessage(messages, "msg_3")?.info.id).toBe("msg_3")
  })

  test("falls back to the last user message without a messageID", () => {
    expect(claudeTurnMessage(messages, undefined)?.info.id).toBe("msg_4")
  })

  test("returns undefined for an unknown id or a non-user id", () => {
    expect(claudeTurnMessage(messages, "msg_nope")).toBeUndefined()
    expect(claudeTurnMessage(messages, "msg_2")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/opencodex/claude-turn-message.test.ts`
Expected: FAIL — `claudeTurnMessage` is not exported.

- [ ] **Step 3: Implement**

In `prompt-schema.ts`, extend `LoopInput` (MessageID is already imported for the neighboring schemas):

```ts
export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
}) {}
```

In `prompt-claim.ts:174`, pass the command's message:

```ts
      const exit = yield* loop({ sessionID: command.session_id, messageID: command.message_id ?? undefined }).pipe(
```

(If `command.message_id`'s column type is non-null in the schema, drop the `?? undefined`.)

In `prompt.ts:727`:

```ts
        const work = (yield* claudeCodeTurn(input.sessionID, input.messageID)) ?? runLoop(input.sessionID)
```

In `prompt-swarm.ts`, add the exported pure helper:

```ts
/**
 * The message a Claude turn should deliver. A queued command names its own
 * message; delivering `lastUserMessage` instead sent the newest text N times
 * and swallowed the earlier queued messages (2026-08-10 spec, problem 2b).
 */
export function claudeTurnMessage<T extends { info: { id: string; role: string } }>(
  messages: readonly T[],
  messageID: string | undefined,
): T | undefined {
  if (messageID === undefined) return messages.findLast((message) => message.info.role === "user")
  const message = messages.find((message) => message.info.id === messageID)
  return message?.info.role === "user" ? message : undefined
}
```

Rework `claudeCodeTurn` to accept and prefer the command's message. The function currently loads only the last user message; load the identified one instead (`lastUserMessage` stays for the no-id fallback — keep whatever query helper exists, adding a by-id variant beside it if needed):

```ts
  const claudeCodeTurn = Effect.fnUntraced(function* (sessionID: SessionID, messageID?: MessageID) {
    const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
    const last = messageID ? yield* userMessage(sessionID, messageID) : yield* lastUserMessage(sessionID)
    ...unchanged, except every use of the old `last` now refers to this selection —
    routing (`selected`), the text extraction, `parentMessageID: last.info.id`,
    and `ensureClaudeTitle(session, text)`...
```

where `userMessage` is a sibling of `lastUserMessage` that loads a message by id and returns it only when `info.role === "user"` (same return shape as `lastUserMessage`). If `lastUserMessage` is built on a query that can filter by id, implement `userMessage` with the same machinery; keep both delegating their role check to `claudeTurnMessage` where practical.

Also update `swarmContext` (prompt-swarm.ts:95-99): it routes from `lastUserMessage` too; give it the same optional `messageID` parameter and thread it from `claudeCodeTurn` so a queued message keeps the model/swarm it was sent with.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/opencode && bun test test/opencodex/claude-turn-message.test.ts && bun run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/session/prompt-schema.ts packages/opencode/src/session/prompt-claim.ts packages/opencode/src/session/prompt.ts packages/opencode/src/session/prompt-swarm.ts packages/opencode/test/opencodex/claude-turn-message.test.ts
git commit -m "fix(session): deliver each queued message to Claude turns instead of the newest one N times"
```

---

### Task 4: Project Claude sidechains into child sessions

**Files:**
- Create: `packages/opencode/src/opencodex/claude-sidechain.ts`
- Modify: `packages/opencode/src/opencodex/claude-driver.ts` (event loop ~lines 233-239; `runTurn` input type)
- Modify: `packages/opencode/src/session/prompt-swarm.ts` (`claudeCodeTurn`'s `runTurn` call, ~line 269)
- Test: `packages/opencode/test/opencodex/claude-sidechain.test.ts` (new)

**Interfaces:**
- Consumes: `ClaudeMapper.mapEvent`, `ClaudeMapper.initialState`, `ClaudeMapper.finalizeAbandonedTurn`, `MapperContext`, `SessionWrite`, `MapperState["toolParts"]`; `sessions.create` and `deps.prompt` in prompt-swarm (the same pair `runSwarmRole` uses at ~line 155).
- Produces (from `claude-sidechain.ts`):

```ts
export type SidechainAction =
  | { kind: "spawn"; chainID: string; title: string; prompt: string }
  | { kind: "writes"; chainID: string; sessionID: string; writes: SessionWrite[] }

export type SidechainRouter = {
  /** Inspect an event. handled=true → the event belongs to a sidechain and must NOT reach the main mapper. */
  route(event: ClaudeEvent, mainToolParts: MapperState["toolParts"]): { handled: boolean; actions: SidechainAction[] }
  /** Called after a spawn action was executed; flushes writes buffered for the chain. */
  attachChild(chainID: string, sessionID: string, userMessageID: string): SidechainAction[]
  /** Turn end: finalize every still-open chain. */
  finalizeAll(): SidechainAction[]
}

export function createSidechainRouter(input: {
  makeContext: (sessionID: string, parentMessageID: string) => MapperContext
}): SidechainRouter
```

- Driver `runTurn` input gains:

```ts
  sidechain?: {
    spawn: (input: { title: string; prompt: string }) => Effect.Effect<{ sessionID: string; userMessageID: string }>
  }
```

- [ ] **Step 1: Write the failing tests**

Create `packages/opencode/test/opencodex/claude-sidechain.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/opencodex/claude-sidechain.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the router**

Create `packages/opencode/src/opencodex/claude-sidechain.ts`:

```ts
import {
  finalizeAbandonedTurn,
  initialState,
  mapEvent,
  type ClaudeEvent,
  type MapperContext,
  type MapperState,
  type SessionWrite,
} from "./claude-mapper"

/**
 * Claude runs subagents as sidechains: the same event stream, tagged with
 * `parent_tool_use_id`. Untagged events belong to the main conversation.
 * This router projects each sidechain into its own child session so the
 * session graph and transcript show subagents instead of dropping them (or
 * leaking their output into the main transcript).
 *
 * Pure state machine: it returns actions; the driver interprets them with
 * effects (session creation, write application).
 */

export type SidechainAction =
  | { kind: "spawn"; chainID: string; title: string; prompt: string }
  | { kind: "writes"; chainID: string; sessionID: string; writes: SessionWrite[] }

type Chain = {
  state: MapperState
  context?: MapperContext
  sessionID?: string
  /** Events seen before the child session exists; replayed on attachChild. */
  pending: ClaudeEvent[]
  done: boolean
}

export type SidechainRouter = ReturnType<typeof createSidechainRouter>

export function createSidechainRouter(input: {
  makeContext: (sessionID: string, parentMessageID: string) => MapperContext
}) {
  const chains = new Map<string, Chain>()

  function mapThrough(chain: Chain, chainID: string, event: ClaudeEvent): SidechainAction[] {
    if (!chain.context) {
      chain.pending.push(event)
      return []
    }
    const mapped = mapEvent(event, chain.state, chain.context)
    chain.state = mapped.state
    if (mapped.writes.length === 0) return []
    return [{ kind: "writes", chainID, sessionID: chain.context.sessionID as string, writes: mapped.writes }]
  }

  function finalize(chain: Chain, chainID: string): SidechainAction[] {
    if (chain.done || !chain.context) {
      chain.done = true
      return []
    }
    chain.done = true
    const finalized = finalizeAbandonedTurn(chain.state, chain.context, { reason: "subagent completed" })
    chain.state = finalized.state
    if (finalized.writes.length === 0) return []
    return [{ kind: "writes", chainID, sessionID: chain.context.sessionID as string, writes: finalized.writes }]
  }

  return {
    route(event: ClaudeEvent, mainToolParts: MapperState["toolParts"]): { handled: boolean; actions: SidechainAction[] } {
      const record = event as unknown as Record<string, unknown>
      const chainID = typeof record.parent_tool_use_id === "string" ? record.parent_tool_use_id : undefined

      if (chainID) {
        const existing = chains.get(chainID)
        if (existing) return { handled: true, actions: existing.done ? [] : mapThrough(existing, chainID, event) }
        const spawning = mainToolParts.get(chainID)
        const spawnInput = (spawning?.input ?? {}) as Record<string, unknown>
        const title =
          (typeof spawnInput.description === "string" && spawnInput.description) ||
          (typeof spawnInput.subagent_type === "string" && `${spawnInput.subagent_type} subagent`) ||
          "Claude subagent"
        const prompt = typeof spawnInput.prompt === "string" ? spawnInput.prompt : ""
        const chain: Chain = { state: initialState({}), pending: [event], done: false }
        chains.set(chainID, chain)
        return { handled: true, actions: [{ kind: "spawn", chainID, title, prompt }] }
      }

      // Main-stream event: a tool_result closing a chain's spawning call settles
      // that chain. The event itself still belongs to the main mapper.
      const actions: SidechainAction[] = []
      const message = record.message as Record<string, unknown> | undefined
      const content = Array.isArray(message?.content) ? (message!.content as Array<Record<string, unknown>>) : []
      if (record.type === "user") {
        for (const block of content) {
          if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue
          const chain = chains.get(block.tool_use_id)
          if (chain) actions.push(...finalize(chain, block.tool_use_id))
        }
      }
      return { handled: false, actions }
    },

    attachChild(chainID: string, sessionID: string, userMessageID: string): SidechainAction[] {
      const chain = chains.get(chainID)
      if (!chain || chain.context) return []
      chain.context = input.makeContext(sessionID, userMessageID)
      chain.sessionID = sessionID
      const pending = chain.pending
      chain.pending = []
      return pending.flatMap((event) => mapThrough(chain, chainID, event))
    },

    finalizeAll(): SidechainAction[] {
      return [...chains.entries()].flatMap(([chainID, chain]) => finalize(chain, chainID))
    },
  }
}

export * as ClaudeSidechain from "./claude-sidechain"
```

Note: `finalizeAbandonedTurn(state, context, { reason, error? })` — match the actual signature at claude-mapper.ts:227; adjust the reason argument if it differs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/opencodex/claude-sidechain.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the router into the driver**

In `packages/opencode/src/opencodex/claude-driver.ts`:

- Extend the `runTurn` input type with the optional `sidechain` capability (exact shape from the Interfaces block above).
- After the mapper context is built (~line 127), create the router:

```ts
      const sidechain = input.sidechain
        ? ClaudeSidechain.createSidechainRouter({
            makeContext: (sessionID, parentMessageID) => ({
              ...context,
              sessionID: sessionID as typeof context.sessionID,
              parentMessageID: parentMessageID as typeof context.parentMessageID,
            }),
          })
        : undefined
```

- In the event loop (~line 233-239), route before mapping, and interpret actions:

```ts
          if (sidechain) {
            const routed = sidechain.route(next.value, live.toolParts)
            yield* interpretSidechainActions(routed.actions)
            if (routed.handled) continue
          }
          const mapped = ClaudeMapper.mapEvent(next.value, live, context)
          ...
```

with a local interpreter (inside `runTurn`, so it closes over `input` and `applyWrites`):

```ts
      const interpretSidechainActions: (actions: ClaudeSidechain.SidechainAction[]) => Effect.Effect<void> =
        Effect.fn("OpencodeXClaudeDriver.sidechain")(function* (actions) {
          for (const action of actions) {
            if (action.kind === "spawn") {
              const child = yield* input.sidechain!.spawn({ title: action.title, prompt: action.prompt }).pipe(
                Effect.catchAll(() => Effect.succeed(undefined)),
              )
              if (child) {
                const flushed = sidechain!.attachChild(action.chainID, child.sessionID, child.userMessageID)
                yield* interpretSidechainActions(flushed)
              }
              continue
            }
            yield* applyWrites(action.writes, action.sessionID)
          }
        })
```

(`applyWrites` already takes `(writes, sessionID)` — see line 238. If its session id parameter is branded, cast the router's plain string back at the callsite.)

- After the event loop ends (both normal completion and the abandoned-turn path), flush: `if (sidechain) yield* interpretSidechainActions(sidechain.finalizeAll())`.

- [ ] **Step 6: Provide the spawn capability from prompt-swarm**

In `packages/opencode/src/session/prompt-swarm.ts`, extend the `claudeDriver.runTurn({...})` call (~line 269) with:

```ts
      sidechain: {
        spawn: (spawnInput: { title: string; prompt: string }) =>
          Effect.gen(function* () {
            const child = yield* sessions
              .create({
                parentID: sessionID,
                directory: session.directory,
                title: `${spawnInput.title} (@claude subagent)`,
                ...(parentPermission(session)),
              })
              .pipe(Effect.orDie)
            const message = yield* prompt({
              sessionID: child.id,
              noReply: true,
              parts: [{ type: "text", text: spawnInput.prompt || spawnInput.title }],
            }).pipe(Effect.orDie)
            return { sessionID: child.id, userMessageID: message.info.id }
          }),
      },
```

Match the exact `sessions.create` / `prompt` shapes used by `runSwarmRole` in this same file (~lines 150-161) — copy its permission passthrough (`...(parent.permission ? { permission: parent.permission } : {})`) and its `noReply` prompt pattern rather than inventing new ones; `parentPermission` above is shorthand for that existing spread.

- [ ] **Step 7: Full test pass + typecheck**

Run: `cd packages/opencode && bun test test/opencodex/ && bun run typecheck`
Expected: PASS / clean. (Some pre-existing unrelated test failures may exist in the broader suite; the opencodex directory must be clean.)

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/opencodex/claude-sidechain.ts packages/opencode/src/opencodex/claude-driver.ts packages/opencode/src/session/prompt-swarm.ts packages/opencode/test/opencodex/claude-sidechain.test.ts
git commit -m "feat(claude-bridge): project subagent sidechains into child sessions"
```

---

### Task 5: Single-line tool rows — truncate long commands

**Files:**
- Modify: `packages/gui/src/renderer/src/styles/pages/sessions/transcript-part.css:64-66` (`.part-header`), `:79-81` (`.part-meta, .part-status`), `:146-151` (`.part-status`)

**Interfaces:**
- Consumes: existing `.part-meta` ellipsis rules (lines 130-137) and the `title` tooltip on `.part-meta-command` (session-transcript.tsx:263).
- Produces: nothing new — CSS behavior change.

- [ ] **Step 1: Stop the header wrapping**

In `transcript-part.css` line 66, change `flex-wrap: wrap;` to `flex-wrap: nowrap;` and add a comment:

```css
.part-header {
  display: flex;
  /* One line, always: a long command meta truncates with an ellipsis instead
     of wrapping the row. The full invocation stays reachable via the meta's
     native tooltip and the expanded details body. */
  flex-wrap: nowrap;
  ...
}
```

- [ ] **Step 2: Protect the fixed slots, let the meta shrink**

Still in `transcript-part.css`:

```css
.part-meta, .part-status {
  margin-left: auto;
}

.part-meta {
  flex: 0 1 auto;
}

.part-status {
  flex-shrink: 0;
}

.part-icon {
  flex-shrink: 0;
}
```

(Fold these into the existing `.part-meta` (line 130) and `.part-status` (line 146) rules rather than adding duplicate selectors; `.part-icon` is at line 102.)

- [ ] **Step 3: Visual check**

Run: `cd packages/gui && bun run check:design-system && bun run typecheck`
Then load the app (or e2e fixture) and confirm: a `bash` tool row with a 300-character command renders as ONE line, command ellipsized, status chip visible; hovering shows the full command; expanding shows the full invocation. Also spot-check a tool row with an error preview (`.part-error-preview`) still fits.

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src/renderer/src/styles/pages/sessions/transcript-part.css
git commit -m "fix(gui): keep tool rows single-line; truncate long commands with ellipsis"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

**Interfaces:** consumes everything above.

- [ ] **Step 1: Restart the coordinator**

Kill the running `bun run … gui-coordinator.ts` process; relaunch or refocus the GUI so `ensureSidecar()` respawns it from current source. Verify with the process list that its creation time is fresh.

- [ ] **Step 2: Todo widget (spec §1)**

In a Claude session, prompt something that makes the model create tasks (e.g. "Use TaskCreate to plan 3 steps for X, then start step 1"). Expected: the transcript shows the todo stepper widget on the task tool rows; the inspector's "Todo" section lists active tasks; statuses update as the model calls TaskUpdate.

- [ ] **Step 3: Queued messages (spec §2b)**

Start a long-running turn, then send three DIFFERENT short messages while it runs. Expected: three separate answers, one per message, in order — none swallowed, none answered twice.

- [ ] **Step 4: No doubling (spec §2a)**

In the same session, inspect the newest assistant messages (SQL against the session DB or visually): every text block appears exactly once.

- [ ] **Step 5: Session graph (spec §3)**

Ask a Claude session to use its Agent/Task tool for a parallelizable task. Expected: child sessions appear under the parent (side panel session tree + session graph populates); the child transcripts contain the subagent's own activity; the main transcript shows only the Task tool row.

- [ ] **Step 6: Single-line rows (spec §4)**

Find (or cause) a tool row with a very long command. Expected: one line, `…` truncation, full command on hover/expand.

- [ ] **Step 7: Report**

Use superpowers:verification-before-completion before claiming done.
