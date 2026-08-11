# Safety Dock Redesign + Transcript Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved question/permission card redesign (auto-submit, slim header, X-dismiss confirm, choice tiles) and fix the three transcript visibility bugs (Read titles/preview, harness tool titles, invisible plans/context).

**Architecture:** Two independent halves. Part B (transcript) fixes the Claude bridge mapper in `packages/opencode` so stored tool parts match native shape, then teaches the GUI title/detail registries about harness tools and plan rendering. Part A rebuilds the safety dock cards in `packages/gui` around a slim shared header, a shared dismiss-confirm dialog, and pure helpers in `safety-present.ts` that make the auto-submit flow unit-testable.

**Tech Stack:** SolidJS renderer, Bun tests (`bun test` in each package; GUI uses `--conditions=browser`), plain CSS design tokens (`--ds-*`).

## Global Constraints

- Branch: work directly on `feat/graph-eng-visualizer` (checkout is shared with other live sessions — do NOT switch branches or touch unrelated dirty files). Commit ONLY files this plan names.
- Spec: `docs/superpowers/specs/2026-08-09-question-card-and-transcript-visibility-design.md` (commit it with the first commit).
- GUI tests: `cd packages/gui && bun test --conditions=browser test/<file>.test.ts`
- Opencode tests: `cd packages/opencode && bun test test/opencodex/<file>.test.ts`
- All motion honors `@media (prefers-reduced-motion: reduce)`.
- Header labels are exactly `Question` and `Permission Request`.
- Visual verification page: `http://127.0.0.1:5174/lab.html?page=safety&theme=dark` (and `theme=light`).

---

### Task 1: Mapper normalizes Claude tool input keys

**Files:**
- Modify: `packages/opencode/src/opencodex/claude-mapper.ts` (mapAssistantBlock ~line 261, mapToolResult ~line 294)
- Test: `packages/opencode/test/opencodex/claude-mapper.test.ts`

**Interfaces:**
- Produces: `normalizeToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown>` exported from claude-mapper.ts. Later GUI tasks rely on stored read/edit/write parts carrying `filePath`.

- [ ] **Step 1: Write the failing test** (append to the `claude stream-json mapper` describe block)

```ts
test("normalizes file tool inputs to native keys so transcript titles resolve", () => {
  const { writes } = run([
    {
      type: "assistant",
      message: {
        id: "m1",
        content: [{ type: "tool_use", id: "call_1", name: "Read", input: { file_path: "C:/repo/a.ts", offset: 10 } }],
      },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "call_1", content: "1\tconst a = 1" }] },
    },
  ])
  const tool = parts(writes).filter((part) => part.type === "tool").at(-1) as Extract<(typeof writes)[number] & { kind: "part" }, never> | any
  expect(tool.state.input).toMatchObject({ filePath: "C:/repo/a.ts", file_path: "C:/repo/a.ts", offset: 10 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/opencodex/claude-mapper.test.ts -t "normalizes file tool inputs"`
Expected: FAIL — `state.input` has no `filePath`.

- [ ] **Step 3: Implement `normalizeToolInput` and wire it in**

In `claude-mapper.ts`, below `normalizeToolName`:

```ts
/**
 * Claude spells file params `file_path`/`notebook_path`; native tools and the
 * GUI registries read `filePath`. Mirror of the permission-layer mapping in
 * claude-permission.ts so transcript parts render like native ones. Original
 * keys are kept so nothing downstream that reads the raw shape breaks.
 */
export function normalizeToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined)
  if (tool === "read" || tool === "edit" || tool === "write") {
    const file = text(input.filePath) ?? text(input.file_path) ?? text(input.notebook_path)
    if (file) return { ...input, filePath: file }
  }
  return input
}
```

In `mapAssistantBlock`, change the tool_use branch input line:

```ts
const input = normalizeToolInput(tool, isRecord(block.input) ? block.input : {})
```

In `mapToolResult`, change the decided-input line so gate-rewritten inputs are normalized too:

```ts
const input = normalizeToolInput(pending.tool, context.decidedInput?.(callID) ?? pending.input)
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/opencode && bun test test/opencodex/claude-mapper.test.ts`
Expected: all PASS (existing tests unaffected — normalization keeps original keys).

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/opencodex/claude-mapper.ts packages/opencode/test/opencodex/claude-mapper.test.ts docs/superpowers/specs/2026-08-09-question-card-and-transcript-visibility-design.md docs/superpowers/plans/2026-08-09-safety-dock-and-transcript-visibility.md
git commit -m "fix(claude-bridge): normalize file tool input keys for transcript display"
```

---

### Task 2: Mapper synthesizes read preview metadata

**Files:**
- Modify: `packages/opencode/src/opencodex/claude-mapper.ts` (mapToolResult completed branch, ~line 306)
- Test: `packages/opencode/test/opencodex/claude-mapper.test.ts`

**Interfaces:**
- Produces: completed Claude `read` parts carry `metadata.preview: string` and `metadata.truncated?: boolean`. The GUI's existing `ToolReadPreview` renders exactly these keys — no GUI change needed.

- [ ] **Step 1: Write the failing test**

```ts
test("read results carry a preview so the transcript expander has content", () => {
  const output = Array.from({ length: 30 }, (_, i) => `${i + 1}\tline ${i + 1}`).join("\n")
  const { writes } = run([
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "call_r", name: "Read", input: { file_path: "C:/repo/a.ts" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "call_r", content: output }] } },
  ])
  const tool = parts(writes).filter((part) => part.type === "tool").at(-1) as any
  expect(tool.state.metadata.preview.split("\n")).toHaveLength(20)
  expect(tool.state.metadata.truncated).toBe(true)
})
```

- [ ] **Step 2: Run to verify FAIL** (`metadata` is `{}`)

- [ ] **Step 3: Implement**

In `claude-mapper.ts` add:

```ts
const READ_PREVIEW_LINES = 20

function completedMetadata(tool: string, output: string): Record<string, unknown> {
  if (tool !== "read" || !output.trim()) return {}
  const lines = output.split("\n")
  const preview = lines.slice(0, READ_PREVIEW_LINES).join("\n")
  return { preview, ...(lines.length > READ_PREVIEW_LINES ? { truncated: true } : {}) }
}
```

In `mapToolResult`'s completed branch replace `metadata: {}` with `metadata: completedMetadata(pending.tool, output)`.

- [ ] **Step 4: Run full mapper test file — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/opencodex/claude-mapper.ts packages/opencode/test/opencodex/claude-mapper.test.ts
git commit -m "fix(claude-bridge): synthesize read preview metadata for transcript expanders"
```

---

### Task 3: GUI titles — tolerant file keys + harness tool registry

**Files:**
- Modify: `packages/gui/src/renderer/src/lib/tool-title.ts`
- Modify: `packages/gui/src/renderer/src/lib/tool-display.ts` (COMMON_TOOL_IDS)
- Test: `packages/gui/test/tool-display.test.ts`

**Interfaces:**
- Produces: `toolDisplayTitle` handles `file_path` fallback and the ids `toolsearch`, `taskcreate`, `taskupdate`, `tasklist`, `taskget`, `agent`, `monitor`, `schedulewakeup`. Raw-JSON expander suppressed for these ids.

- [ ] **Step 1: Write the failing tests**

```ts
test("titles Claude-shaped file inputs and harness tools", () => {
  expect(toolDisplayTitle("read", { file_path: "C:/repo/a.ts" }, {})).toBe("Read C:/repo/a.ts")
  expect(toolDisplayTitle("toolsearch", { query: "select:TaskCreate" }, {})).toBe('Search tools "select:TaskCreate"')
  expect(toolDisplayTitle("taskcreate", { subject: "Implement new feature" }, {})).toBe("Create task — Implement new feature")
  expect(toolDisplayTitle("taskupdate", { taskId: "4", status: "completed" }, {})).toBe("Update task #4 — completed")
  expect(toolDisplayTitle("taskupdate", { taskId: "4", subject: "Rename" }, {})).toBe("Update task #4")
  expect(toolDisplayTitle("tasklist", {}, {})).toBe("List tasks")
  expect(toolDisplayTitle("taskget", { taskId: "2" }, {})).toBe("Task #2")
  expect(toolDisplayTitle("agent", { subagent_type: "Explore", description: "Find lab routes" }, {})).toBe("Agent Explore: Find lab routes")
  expect(toolDisplayTitle("monitor", { action: "start" }, {})).toBe("Monitor start")
  expect(toolDisplayTitle("schedulewakeup", { delaySeconds: 300 }, {})).toBe("Schedule wakeup in 300s")
  expect(shouldShowRawToolData("taskcreate", { subject: "x" }, {})).toBe(false)
  expect(shouldShowRawToolData("toolsearch", { query: "x" }, {})).toBe(false)
})
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd packages/gui && bun test --conditions=browser test/tool-display.test.ts -t "harness tools"`

- [ ] **Step 3: Implement**

In `tool-title.ts`, change `fileToolTitle` and add registry entries:

```ts
function fileToolTitle(action: string, input: Record<string, unknown>) {
  const file = stringValue(input.filePath) ?? stringValue(input.file_path) ?? stringValue(input.notebook_path)
  return `${action} ${file ?? "file"}`
}
```

Add to `TOOL_TITLE_BY_ID` (keep the verb-first grammar):

```ts
  toolsearch: (input) => `Search tools ${quoteValue(input.query)}`.trim(),
  taskcreate: (input) => stringFieldTitle("Create task —", input.subject) ?? "Create task",
  taskupdate: (input) => {
    const id = stringValue(input.taskId)
    const status = stringValue(input.status)
    if (!id) return "Update task"
    return status ? `Update task #${id} — ${status}` : `Update task #${id}`
  },
  tasklist: () => "List tasks",
  taskget: (input) => (stringValue(input.taskId) ? `Task #${stringValue(input.taskId)}` : "Get task"),
  agent: (input) => `Agent ${stringValue(input.subagent_type) ?? "general"}: ${stringValue(input.description) ?? "subagent"}`,
  monitor: (input) => stringFieldTitle("Monitor", input.action) ?? "Monitor",
  schedulewakeup: (input) => {
    const seconds = numberValue(input.delaySeconds)
    return seconds === undefined ? "Schedule wakeup" : `Schedule wakeup in ${seconds}s`
  },
```

(`numberValue` is already imported in tool-title.ts.)

In `tool-display.ts`, extend `COMMON_TOOL_IDS` with: `"toolsearch", "taskcreate", "taskupdate", "tasklist", "taskget", "agent", "monitor", "schedulewakeup", "plan_exit"`.

- [ ] **Step 4: Run the full gui test file — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/gui/src/renderer/src/lib/tool-title.ts packages/gui/src/renderer/src/lib/tool-display.ts packages/gui/test/tool-display.test.ts
git commit -m "feat(gui): readable transcript titles for harness tools and Claude file inputs"
```

---

### Task 4: GUI tool details for harness tools

**Files:**
- Modify: `packages/gui/src/renderer/src/components/session-tool-details.tsx`
- Test: existing `tool-display.test.ts` covers `toolHasVisibleDetails` behavior; rendering verified in lab/live.

**Interfaces:**
- Consumes: ids from Task 3.
- Produces: expanding a ToolSearch/Task* row shows key fields + the tool's output text (ungated by the generic-output setting).

- [ ] **Step 1: Add a Match branch in `ToolDetails`** (before the `task` Match):

```tsx
<Match when={HARNESS_TASK_TOOLS.has(props.tool)}>
  <ToolKeyValues
    values={[
      field("Query", stringValue(props.input.query)),
      field("Subject", stringValue(props.input.subject)),
      field("Description", stringValue(props.input.description)),
      field("Status", stringValue(props.input.status)),
      field("Task", stringValue(props.input.taskId)),
    ]}
  />
  <ToolOutput output={props.output} maxLines={15} compact />
</Match>
```

With, at module scope:

```ts
const HARNESS_TASK_TOOLS = new Set(["toolsearch", "taskcreate", "taskupdate", "tasklist", "taskget", "monitor", "schedulewakeup"])
```

(`field` and `stringValue` are already imported.)

- [ ] **Step 2: Run gui tests (no regressions), then visually verify** on a live Claude session or unit-render if trivial.

- [ ] **Step 3: Commit**

```bash
git add packages/gui/src/renderer/src/components/session-tool-details.tsx
git commit -m "feat(gui): useful expanders for harness task/search tools"
```

---

### Task 5: Plan card — render plan_exit as expandable markdown

**Files:**
- Modify: `packages/gui/src/renderer/src/lib/tool-title.ts` (`plan_exit` title)
- Modify: `packages/gui/src/renderer/src/components/session-tool-details.tsx` (plan Match)
- Modify: `packages/gui/src/renderer/src/components/session-transcript.tsx` (KEEP_OPEN_WHEN_COMPLETE)
- Modify: `packages/gui/src/renderer/src/styles/global/components/part-tools.css` — locate with `grep -rn "tool-details" packages/gui/src/renderer/src/styles` and add the block to that file.
- Test: `packages/gui/test/tool-display.test.ts`

**Interfaces:**
- Produces: `plan_exit` parts render the full plan markdown, stay open on completion, and `toolHasVisibleDetails("plan_exit", {plan}, …)` is true.

- [ ] **Step 1: Failing test**

```ts
test("plan_exit renders as a plan deliverable", () => {
  expect(toolDisplayTitle("plan_exit", { plan: "# Plan" }, {})).toBe("Proposed plan")
  expect(toolHasVisibleDetails("plan_exit", { plan: "# Plan" }, {}, "")).toBe(true)
})
```

- [ ] **Step 2: Run — FAIL** (title is "Exit plan mode"; no visible details since `plan_exit` now suppresses raw data)

- [ ] **Step 3: Implement**

tool-title.ts: `plan_exit: () => "Proposed plan",`

tool-display.ts — in `toolHasRichDetails` add `stringValue(input.plan) ||` to the Boolean chain.

session-transcript.tsx: `KEEP_OPEN_WHEN_COMPLETE = new Set(["todowrite", "apply_patch", "plan_exit"])`

session-tool-details.tsx — add Match + import `Markdown` and a copy affordance:

```tsx
import { Markdown } from "@opencode-ai/ui/markdown"

<Match when={props.tool === "plan_exit"}>
  <Show when={stringValue(props.input.plan)}>
    {(plan) => (
      <div class="tool-plan">
        <Markdown text={plan()} />
        <Button appearance="ghost" type="button" onClick={() => void copyFullToolText(plan())}>Copy plan</Button>
      </div>
    )}
  </Show>
  <ToolOutput output={props.output} />
</Match>
```

CSS (in the stylesheet that owns `.tool-details`):

```css
.tool-plan {
  display: grid;
  gap: var(--ds-space-2);
  max-height: 420px;
  overflow: auto;
  padding: var(--ds-space-3);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-control);
  background: var(--ds-canvas);
  scrollbar-width: thin;
}
```

- [ ] **Step 4: Run gui test file — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/gui/src/renderer/src/lib/tool-title.ts packages/gui/src/renderer/src/lib/tool-display.ts packages/gui/src/renderer/src/components/session-tool-details.tsx packages/gui/src/renderer/src/components/session-transcript.tsx packages/gui/src/renderer/src/styles/global/components/*.css
git commit -m "feat(gui): render ExitPlanMode plans as expandable markdown deliverables"
```

---

### Task 6: safety-present helpers — flow logic + question context

**Files:**
- Modify: `packages/gui/src/renderer/src/lib/safety-present.ts`
- Test: `packages/gui/test/safety-present.test.ts`

**Interfaces:**
- Consumes: `MessageBundle` from `../lib/session-api` (`{ info: { role, time }, parts: Part[] }`).
- Produces:
  - `nextUnansweredStep(answers: QuestionAnswer[], custom: string[], fromStep: number): number | undefined` — index of the next step (after `fromStep`, wrapping, excluding `fromStep`) whose final answer is empty.
  - `latestAssistantContext(messages: MessageBundle[]): { text?: string; plan?: string }` — from the last assistant message: last visible text part (non-synthetic, non-ignored, trimmed) and last `plan_exit` tool part's `input.plan`.

- [ ] **Step 1: Failing tests**

```ts
import { finalQuestionAnswers, latestAssistantContext, nextUnansweredStep } from "../src/renderer/src/lib/safety-present"

test("nextUnansweredStep wraps and skips answered steps", () => {
  expect(nextUnansweredStep([[], ["A"], []], ["", "", ""], 0)).toBe(2)
  expect(nextUnansweredStep([["A"], [], []], ["", "", ""], 2)).toBe(1)
  expect(nextUnansweredStep([["A"], ["B"]], ["", ""], 0)).toBeUndefined()
  expect(nextUnansweredStep([[], []], ["typed", ""], 0)).toBe(1) // custom text answers step 0
})

test("latestAssistantContext surfaces last visible text and plan", () => {
  const messages = [
    { info: { role: "user" }, parts: [] },
    {
      info: { role: "assistant" },
      parts: [
        { id: "p1", type: "text", text: "First" },
        { id: "p2", type: "tool", tool: "plan_exit", state: { status: "completed", input: { plan: "# The plan" }, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } } },
        { id: "p3", type: "text", text: "  Review the plan below.  " },
        { id: "p4", type: "text", text: "", synthetic: true },
      ],
    },
  ] as never
  expect(latestAssistantContext(messages)).toEqual({ text: "Review the plan below.", plan: "# The plan" })
  expect(latestAssistantContext([] as never)).toEqual({})
})
```

- [ ] **Step 2: Run — FAIL** (`cd packages/gui && bun test --conditions=browser test/safety-present.test.ts`)

- [ ] **Step 3: Implement** (in safety-present.ts; import `Part` type and `MessageBundle`)

```ts
import type { MessageBundle } from "./session-api"

export function nextUnansweredStep(answers: QuestionAnswer[], custom: string[], fromStep: number): number | undefined {
  const final = finalQuestionAnswers(answers, custom)
  for (let offset = 1; offset <= final.length; offset++) {
    const step = (fromStep + offset) % final.length
    if (step === fromStep) continue
    if ((final[step] ?? []).length === 0) return step
  }
  return undefined
}

/**
 * The question card shows the model's accompanying words when they exist. The
 * accompanying prose can be lost upstream (see the 2026-08-09 spec, Part B
 * finding 3), so both fields are best-effort.
 */
export function latestAssistantContext(messages: MessageBundle[]): { text?: string; plan?: string } {
  const message = [...messages].reverse().find((bundle) => bundle.info.role === "assistant")
  if (!message) return {}
  let text: string | undefined
  let plan: string | undefined
  for (const part of message.parts) {
    if (part.type === "text" && !part.synthetic && !part.ignored && part.text.trim()) text = part.text.trim()
    if (part.type === "tool" && part.tool === "plan_exit") {
      const input = "input" in part.state && typeof part.state.input === "object" && part.state.input !== null ? (part.state.input as Record<string, unknown>) : {}
      if (typeof input.plan === "string" && input.plan.trim()) plan = input.plan
    }
  }
  return { ...(text ? { text } : {}), ...(plan ? { plan } : {}) }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/gui/src/renderer/src/lib/safety-present.ts packages/gui/test/safety-present.test.ts
git commit -m "feat(gui): safety flow helpers for auto-advance and question context"
```

---

### Task 7: Shared dismiss confirm + slim SafetyCardHeader

**Files:**
- Create: `packages/gui/src/renderer/src/components/session-safety-confirm.tsx`
- Modify: `packages/gui/src/renderer/src/components/session-safety-card.tsx`

**Interfaces:**
- Produces:
  - `SafetyDismissConfirm(props: { open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void })`
  - `SafetyCardHeader(props: { icon: string; label: string; titleID: string; position: SafetyQueuePosition; onDismiss: () => void; dismissLabel: string })` — single-line strip; the `label` element carries `id={titleID}` (cards keep `aria-labelledby` working). The old `title` prop is gone.

- [ ] **Step 1: Create `session-safety-confirm.tsx`**

```tsx
import { Button, Dialog, DialogFooter } from "./ui"

/**
 * One confirm surface for both card types: dismissing a question and rejecting
 * a permission are the same destructive gesture, so they share copy shape,
 * focus order (Cancel first), and Escape behavior via Dialog.
 */
export function SafetyDismissConfirm(props: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      title={props.title}
      size="sm"
      class="safety-dismiss-confirm"
      footer={
        <DialogFooter align="end">
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button appearance="solid" tone="danger" onClick={props.onConfirm}>{props.confirmLabel}</Button>
        </DialogFooter>
      }
    >
      <p class="safety-dismiss-body">{props.body}</p>
    </Dialog>
  )
}
```

Check `packages/gui/src/renderer/src/components/ui/index.ts(x)` exports `Dialog`/`DialogFooter`; if not, import from `./ui/dialog`.

- [ ] **Step 2: Rewrite `SafetyCardHeader`**

```tsx
export function SafetyCardHeader(props: {
  icon: string
  label: string
  titleID: string
  position: SafetyQueuePosition
  onDismiss: () => void
  dismissLabel: string
}) {
  const positionText = () => (props.position.total > 1 ? `${props.position.index + 1} of ${props.position.total}` : "1 request")
  const description = () =>
    [`Request ${props.position.index + 1} of ${props.position.total} awaiting your input`, props.position.upNext ? `then ${props.position.upNext}` : ""]
      .filter(Boolean)
      .join(", ")
  return (
    <header class="safety-card-header">
      <div class="safety-card-heading">
        <span class="safety-card-icon"><Icon name={props.icon} /></span>
        <p class="safety-card-label" id={props.titleID}>{props.label}</p>
      </div>
      <div class="safety-card-tools">
        <div class="safety-queue" aria-label={description()}>
          <Show when={props.position.canNavigate}>
            <IconButton appearance="ghost" size="compact" icon="chevronLeft" label="Previous request" onClick={props.position.previous} />
          </Show>
          <span class="safety-queue-count">{positionText()}</span>
          <Show when={props.position.upNext}>
            {(upNext) => <span class="safety-queue-more">+{upNext()}</span>}
          </Show>
          <Show when={props.position.canNavigate}>
            <IconButton appearance="ghost" size="compact" icon="chevronRight" label="Next request" onClick={props.position.next} />
          </Show>
        </div>
        <IconButton appearance="ghost" size="compact" icon="x" class="safety-card-dismiss" label={props.dismissLabel} onClick={props.onDismiss} />
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Typecheck** — `cd packages/gui && bun run typecheck` (check package.json for the exact script; fall back to `bunx tsc --noEmit -p .`). Expect the two card components to fail compilation (old props) — fixed in Tasks 8–9. If the repo typecheck is strict per-commit, fold Steps here into the Task 8/9 commit instead.

- [ ] **Step 4: Commit together with Task 8 or 9 if typecheck blocks; otherwise:**

```bash
git add packages/gui/src/renderer/src/components/session-safety-confirm.tsx packages/gui/src/renderer/src/components/session-safety-card.tsx
git commit -m "feat(gui): slim safety card header with shared dismiss confirm"
```

---

### Task 8: Permission card — slim header, body headline, X = reject

**Files:**
- Modify: `packages/gui/src/renderer/src/components/session-permission-card.tsx`

**Interfaces:**
- Consumes: Task 7 header/confirm.
- Produces: permission card with `label="Permission Request"`, headline `<h2>` in body, footer = Always allow + Allow once only, X/`3`/Escape → confirm → `reply(request, "reject")`.

- [ ] **Step 1: Implement**

- Add `const [confirmOpen, setConfirmOpen] = createSignal(false)`.
- Header: `<SafetyCardHeader icon={presentation().icon} label="Permission Request" titleID={titleID} position={props.position} dismissLabel="Reject request" onDismiss={() => setConfirmOpen(true)} />`
- Body top: `<h2 class="safety-card-title" id={`${titleID}-title`}>{presentation().title}</h2>` as the first child of `.safety-card-body` (keep `aria-labelledby={titleID}` pointing at the header label; add `aria-describedby` if trivial).
- Keyboard: `if (event.key === "3" || event.key === "Escape") setConfirmOpen(true)` (Escape only when confirm closed; Dialog handles its own Escape via stopPropagation).
- Footer: remove the Reject button; keep spacer + Always allow + Allow once.
- Append inside the card:

```tsx
<SafetyDismissConfirm
  open={confirmOpen()}
  title="Reject this request?"
  body="Claude is waiting on this approval. Rejecting tells Claude it may not run the tool, and it will continue without it."
  confirmLabel="Reject"
  onConfirm={() => { setConfirmOpen(false); choose("reject") }}
  onCancel={() => { setConfirmOpen(false); requestAnimationFrame(() => card?.focus({ preventScroll: true })) }}
/>
```

- [ ] **Step 2: Verify in lab** — permissions stage: header reads "Permission Request", title in body, X → confirm → reject removes card, `1`/`2` still instant, `3`/Esc → confirm.

- [ ] **Step 3: Run gui tests (no regressions) and commit**

```bash
git add packages/gui/src/renderer/src/components/session-permission-card.tsx packages/gui/src/renderer/src/components/session-safety-confirm.tsx packages/gui/src/renderer/src/components/session-safety-card.tsx
git commit -m "feat(gui): permission card slim header with confirmed reject"
```

---

### Task 9: Question card — tiles, auto-submit, no footer, context

**Files:**
- Modify: `packages/gui/src/renderer/src/components/session-question-card.tsx`
- Modify: `packages/gui/src/renderer/src/components/session-safety-dock.tsx`

**Interfaces:**
- Consumes: Task 6 helpers, Task 7 header/confirm.
- Produces: `SessionQuestionCard` gains `context?: { text?: string; plan?: string }` prop; dock passes `latestAssistantContext(props.messages)`.

- [ ] **Step 1: Rewrite `session-question-card.tsx`**

```tsx
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { finalQuestionAnswers, nextUnansweredStep, questionAnswersComplete, toggleQuestionAnswer } from "../lib/safety-present"
import { isKeyboardEditingTarget } from "../lib/keyboard-shortcuts"
import { SafetyCardHeader, type SafetyQueuePosition } from "./session-safety-card"
import { SafetyDismissConfirm } from "./session-safety-confirm"
import type { QuestionDraft } from "./session-safety-dock"
import { Button, SurfaceCard, TextField } from "./ui"

const CONFIRM_PULSE_MS = 200

/**
 * One question per card; the top-right pill is the only pagination. Answers
 * auto-submit: the reply fires as soon as a selection completes the whole
 * request, so there is no footer. Dismissing always confirms first.
 */
export function SessionQuestionCard(props: {
  request: QuestionRequest
  step: number
  draft: QuestionDraft
  updateDraft: (update: (draft: QuestionDraft) => QuestionDraft) => void
  position: SafetyQueuePosition
  setCard: (element: HTMLElement) => void
  reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  reject: (request: QuestionRequest) => void
  context?: { text?: string; plan?: string }
}) {
  const titleID = `question-title-${createUniqueId()}`
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  const [planOpen, setPlanOpen] = createSignal(false)
  const [pulsing, setPulsing] = createSignal<string>()
  let card: HTMLElement | undefined
  let submitTimer: ReturnType<typeof setTimeout> | undefined
  let submitted = false
  const question = createMemo(() => props.request.questions[props.step])
  const selected = createMemo(() => props.draft.answers[props.step] ?? [])
  const customValue = createMemo(() => props.draft.custom[props.step] ?? "")
  const complete = createMemo(() => questionAnswersComplete(props.draft.answers, props.draft.custom))
  const stepAnswered = createMemo(() => (finalQuestionAnswers(props.draft.answers, props.draft.custom)[props.step] ?? []).length > 0)

  onCleanup(() => clearTimeout(submitTimer))

  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

  function submitWith(answers: QuestionAnswer[], custom: string[]) {
    if (submitted) return
    submitted = true
    props.reply(props.request, finalQuestionAnswers(answers, custom))
  }

  /** After a selection: submit when the request is complete, else advance. */
  function settle(answers: QuestionAnswer[], custom: string[], pulseLabel?: string) {
    const done = questionAnswersComplete(answers, custom)
    const advance = () => {
      const next = nextUnansweredStep(answers, custom, props.step)
      if (next !== undefined && props.position.canNavigate) {
        const delta = next - props.step
        for (let i = 0; i < Math.abs(delta); i++) delta > 0 ? props.position.next() : props.position.previous()
      }
    }
    const act = () => (done ? submitWith(answers, custom) : advance())
    if (!pulseLabel || reduceMotion()) return act()
    setPulsing(pulseLabel)
    clearTimeout(submitTimer)
    submitTimer = setTimeout(() => { setPulsing(undefined); act() }, CONFIRM_PULSE_MS)
  }

  function choose(label: string) {
    const current = question()
    if (!current) return
    const answers = toggleQuestionAnswer(props.draft.answers, props.step, label, current.multiple)
    props.updateDraft((draft) => ({ ...draft, answers }))
    if (!current.multiple) settle(answers, props.draft.custom, label)
  }

  function confirmStep() {
    if (complete()) return submitWith(props.draft.answers, props.draft.custom)
    if (stepAnswered()) settle(props.draft.answers, props.draft.custom)
  }

  return (
    <SurfaceCard
      class="safety-card question-card"
      tone="info"
      role="dialog"
      aria-labelledby={titleID}
      tabIndex={-1}
      ref={(element) => { card = element; props.setCard(element) }}
      onKeyDown={(event) => {
        if (isKeyboardEditingTarget(event.target)) {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && complete()) submitWith(props.draft.answers, props.draft.custom)
          return
        }
        if (event.key === "Escape") setConfirmOpen(true)
        if (event.key === "Enter") confirmStep()
        if (event.key === "ArrowLeft" && props.position.canNavigate) props.position.previous()
        if (event.key === "ArrowRight" && props.position.canNavigate) props.position.next()
        const option = Number(event.key)
        const chosen = question()?.options[option - 1]
        if (chosen && option >= 1 && option <= 9) choose(chosen.label)
      }}
    >
      <SafetyCardHeader icon="session" label="Question" titleID={titleID} position={props.position} dismissLabel="Dismiss question" onDismiss={() => setConfirmOpen(true)} />

      <div class="safety-card-body question-card-body">
        <Show when={props.context?.text || props.context?.plan}>
          <div class="question-context">
            <Show when={props.context?.text}>
              {(text) => <div class="question-context-text"><Markdown text={text()} /></div>}
            </Show>
            <Show when={props.context?.plan}>
              <Button appearance="outline" size="compact" leadingIcon="file" onClick={() => setPlanOpen(true)}>View plan</Button>
            </Show>
          </div>
        </Show>
        <Show when={question()}>
          {(current) => (
            <div class="question-step">
              <h2 class="question-headline">{current().question}</h2>
              <div class="question-options" role={current().multiple ? "group" : "radiogroup"} aria-label={current().header}>
                <For each={current().options}>
                  {(option, index) => (
                    <Button
                      class="question-option"
                      classList={{ "is-selected": selected().includes(option.label), "is-pulsing": pulsing() === option.label }}
                      appearance="ghost"
                      role={current().multiple ? "checkbox" : "radio"}
                      aria-checked={selected().includes(option.label)}
                      aria-keyshortcuts={index() < 9 ? String(index() + 1) : undefined}
                      style={{ "--option-index": index() }}
                      onClick={() => choose(option.label)}
                    >
                      <kbd aria-hidden="true">{index() + 1}</kbd>
                      <span class="question-option-copy"><strong>{option.label}</strong><Show when={option.description}><small>{option.description}</small></Show></span>
                      <Show when={current().multiple}><span class="question-option-check" aria-hidden="true" /></Show>
                    </Button>
                  )}
                </For>
              </div>
              <Show when={current().custom !== false}>
                <TextField
                  fieldClass="question-custom-answer"
                  label="Or type your own answer"
                  value={customValue()}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    props.updateDraft((draft) => ({
                      ...draft,
                      custom: draft.custom.map((current, index) => (index === props.step ? value : current)),
                    }))
                  }}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return
                    event.preventDefault()
                    if (customValue().trim()) settle(props.draft.answers, props.draft.custom)
                    else if (complete()) submitWith(props.draft.answers, props.draft.custom)
                  }}
                  placeholder="Type a different answer"
                />
              </Show>
              <Show when={question()?.multiple && stepAnswered()}>
                <div class="question-inline-confirm">
                  <Button appearance="solid" tone="accent" trailingIcon={complete() ? "send" : "chevronRight"} onClick={confirmStep}>
                    {complete() ? "Send answers" : "Next"}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <SafetyDismissConfirm
        open={confirmOpen()}
        title="Dismiss this question?"
        body="Claude is waiting on your answer. Dismissing rejects the question and Claude continues without your input."
        confirmLabel="Dismiss"
        onConfirm={() => { setConfirmOpen(false); props.reject(props.request) }}
        onCancel={() => { setConfirmOpen(false); requestAnimationFrame(() => card?.focus({ preventScroll: true })) }}
      />
      <Show when={props.context?.plan}>
        {(plan) => (
          <SafetyPlanDialog open={planOpen()} plan={plan()} onClose={() => setPlanOpen(false)} />
        )}
      </Show>
    </SurfaceCard>
  )
}

function SafetyPlanDialog(props: { open: boolean; plan: string; onClose: () => void }) {
  const { Dialog } = require("./ui") // replace with a static import alongside Button/SurfaceCard
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Proposed plan" size="lg" class="safety-plan-dialog">
      <div class="tool-plan"><Markdown text={props.plan} /></div>
    </Dialog>
  )
}
```

Note for implementer: use a normal static import for `Dialog` (`import { Button, Dialog, SurfaceCard, TextField } from "./ui"`) — the `require` line above is a placeholder to keep the snippet single-block; also check `TextField` forwards `onKeyDown` (if not, wrap the field or attach via `fieldClass` container listener).

If TextField does not forward `onKeyDown`, handle Enter inside the card-level `onKeyDown` instead: `isKeyboardEditingTarget(event.target)` branch adds `if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && customValue().trim()) { event.preventDefault(); settle(props.draft.answers, props.draft.custom) }`.

- [ ] **Step 2: Wire the dock** — in `session-safety-dock.tsx` import `latestAssistantContext` and pass `context={latestAssistantContext(props.messages)}` to `SessionQuestionCard` (compute via `createMemo` on `props.messages`).

- [ ] **Step 3: Verify in lab** — questions stage:
  - single-select pulses then advances; answering the second question auto-submits (toast "Question answered")
  - multi-select shows inline Next/Send answers; Enter works
  - no footer; X and Escape open the confirm; Cancel restores focus to the card
  - custom answer Enter advances/submits
- [ ] **Step 4: Run all gui tests** (`bun test --conditions=browser test/safety-present.test.ts test/tool-display.test.ts` plus the full suite if quick)

- [ ] **Step 5: Commit**

```bash
git add packages/gui/src/renderer/src/components/session-question-card.tsx packages/gui/src/renderer/src/components/session-safety-dock.tsx
git commit -m "feat(gui): question card auto-submit flow with context and confirmed dismiss"
```

---

### Task 10: Safety CSS rework

**Files:**
- Modify: `packages/gui/src/renderer/src/styles/global/overlays/safety.css`
- Modify: `packages/gui/src/renderer/src/styles/global/overlays/safety-detail.css`

- [ ] **Step 1: safety.css header/body/footer updates**

Replace the `.safety-card-header`, `.safety-card-heading`, `.safety-card-label`, `.safety-card h2` blocks with:

```css
.safety-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-3);
  min-height: 40px;
  padding: var(--ds-space-2) var(--ds-space-3);
  border-bottom: 1px solid var(--ds-border-subtle);
  background: color-mix(in srgb,var(--ui-tone) 5%,transparent);
}

.safety-card-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--ds-space-2);
}

.safety-card-icon {
  display: grid;
  flex: none;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: var(--ds-radius-control);
}

.safety-card-label {
  margin: 0;
  color: var(--ds-text);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}

.safety-card-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ds-space-1);
}

.safety-card-dismiss:hover {
  color: var(--ds-danger);
}

.safety-card-title {
  margin: 0;
  color: var(--ds-text);
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -.01em;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
```

(Keep `.safety-card-actions` for the permission footer; delete `.question-answer-progress` and the `.permission-card .safety-card-icon` / `.question-card .safety-card-icon` tone rules stay.)

- [ ] **Step 2: safety-detail.css question blocks**

Replace `.question-step>p`, `.question-options`, `.question-option*` blocks with:

```css
.question-headline {
  max-width: 72ch;
  margin: 0;
  color: var(--ds-text);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -.01em;
}

.question-context {
  display: grid;
  gap: var(--ds-space-2);
  max-height: 180px;
  overflow: auto;
  padding: var(--ds-space-2) var(--ds-space-3);
  border-left: 2px solid color-mix(in srgb,var(--ds-info) 45%,transparent);
  border-radius: 0 var(--ds-radius-control) var(--ds-radius-control) 0;
  background: color-mix(in srgb,var(--ds-info) 4%,transparent);
  color: var(--ds-text-muted);
  font-size: 12.5px;
  scrollbar-width: thin;
}

.question-options {
  display: grid;
  gap: 6px;
}

.question-option {
  height: auto;
  min-height: 48px;
  align-items: center;
  justify-content: flex-start;
  gap: var(--ds-space-3);
  padding: var(--ds-space-2) var(--ds-space-3);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-control);
  background: color-mix(in srgb,var(--ds-surface) 60%,transparent);
  text-align: left;
  white-space: normal;
  transition: border-color var(--ds-motion-hover) ease, background var(--ds-motion-hover) ease, transform var(--ds-motion-hover) ease, box-shadow var(--ds-motion-hover) ease;
  animation: question-option-in .28s cubic-bezier(.16,1,.3,1) both;
  animation-delay: calc(var(--option-index, 0) * 20ms);
}

.question-option:hover:not(:disabled) {
  border-color: var(--ds-border-strong);
  background: var(--ds-surface-raised);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px color-mix(in srgb,var(--ds-canvas) 40%,transparent);
}

.question-option.is-selected {
  border-color: var(--ds-control-accent);
  background: color-mix(in srgb,var(--ds-control-accent) 8%,transparent);
}

.question-option.is-pulsing {
  animation: question-option-pulse .2s ease;
}

.question-option-check {
  margin-left: auto;
  width: 16px;
  height: 16px;
  flex: none;
  border: 1.5px solid var(--ds-border);
  border-radius: 50%;
  transition: border-color var(--ds-motion-hover) ease, background var(--ds-motion-hover) ease;
}

.question-option.is-selected .question-option-check {
  border-color: var(--ds-control-accent);
  background: var(--ds-control-accent) center / 10px no-repeat
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='4'><path d='M20 6 9 17l-5-5'/></svg>");
}

.question-inline-confirm {
  display: flex;
  justify-content: flex-end;
}

@keyframes question-option-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes question-option-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb,var(--ds-control-accent) 45%,transparent); }
  100% { box-shadow: 0 0 0 6px transparent; }
}
```

Keep the existing `kbd` styles. Extend the reduced-motion block:

```css
@media (prefers-reduced-motion: reduce) {
  .safety-dock,
  .safety-card,
  .question-option {
    animation: none;
  }
}
```

- [ ] **Step 3: Verify both lab themes**, all three stages, narrow width (720px media block still sane).

- [ ] **Step 4: Commit**

```bash
git add packages/gui/src/renderer/src/styles/global/overlays/safety.css packages/gui/src/renderer/src/styles/global/overlays/safety-detail.css
git commit -m "feat(gui): safety card visual rework - slim header, choice tiles, motion"
```

---

### Task 11: Lab safety page — context mock + copy

**Files:**
- Modify: `packages/gui/src/renderer/src/components/lab/lab-safety.tsx`

- [ ] **Step 1:** Build a `MessageBundle[]` mock (typed via `as unknown as MessageBundle[]`) with one assistant message containing a text part ("I compared three approaches; OAuth keeps refresh handling server-side. Pick what fits.") and a `plan_exit` tool part with a short markdown plan. Pass it as `messages` in `SafetyStage`'s `SessionSafetyDock`. Import the type from `../../lib/session-api`.
- [ ] **Step 2:** Update the three `Section` `detail` strings: questions auto-submit on the completing selection, no footer, X-dismiss confirms, context block above the question.
- [ ] **Step 3:** Verify the lab page renders the context block and View plan dialog.
- [ ] **Step 4: Commit**

```bash
git add packages/gui/src/renderer/src/components/lab/lab-safety.tsx
git commit -m "chore(gui): lab safety stages exercise context, plan, and auto-submit"
```

---

### Task 12: AGENTS.md convention note

**Files:**
- Modify: `AGENTS.md` (repo root — append to the most fitting existing section)

- [ ] **Step 1:** Add:

```markdown
## Questions need their context attached

Assistant prose emitted mid-turn can be lost upstream of the GUI (see
docs/superpowers/specs/2026-08-09-question-card-and-transcript-visibility-design.md,
Part B finding 3). When asking the user to approve or choose anything, put the
material they need INSIDE the question payload (the `question` field renders
markdown and long text) or in a committed file the question references — never
rely on turn-middle message text being visible.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: questions must carry their own context"
```

---

### Task 13 (experiment, last): partial message streaming recovers text

**Files:**
- Modify: `packages/opencode/src/opencodex/claude-transport.ts` (`createSdkTransport` options)
- Modify: `packages/opencode/src/opencodex/claude-mapper.ts`
- Test: `packages/opencode/test/opencodex/claude-mapper.test.ts`

**Interfaces:**
- Produces: text parts keyed `text:<apiMessageID>:<blockIndex>`; `MapperState` gains `apiMessageID?: string`. Stream deltas build text parts incrementally; the final assistant event overwrites the same part ids (no duplicates).

- [ ] **Step 1: Failing test**

```ts
test("stream deltas build text parts that the final event reuses", () => {
  const { writes } = run([
    { type: "stream_event", event: { type: "message_start", message: { id: "m9" } } } as never,
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } } as never,
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } } } as never,
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } } } as never,
    { type: "assistant", message: { id: "m9", content: [{ type: "text", text: "Hello world" }] } },
  ])
  const texts = parts(writes).filter((part) => part.type === "text")
  expect(texts.at(-1)).toMatchObject({ text: "Hello world" })
  expect(new Set(texts.map((part) => part.id)).size).toBe(1)
})
```

- [ ] **Step 2: Run — FAIL** (stream_event ignored; final event keys by length)

- [ ] **Step 3: Implement in claude-mapper.ts**

- `MapperState`: add `apiMessageID?: string` and `streamText: Map<string, string>` (initialize in `initialState`, copy in `mapEvent`/`startTurn`/`finalizeAbandonedTurn` next-state spreads).
- New branch in `mapEvent` before the `assistant` branch:

```ts
if (event.type === "stream_event" && isRecord(event.event)) {
  const stream = event.event as Record<string, unknown>
  if (stream.type === "message_start" && isRecord(stream.message) && typeof stream.message.id === "string") {
    next.apiMessageID = stream.message.id
    return { writes, state: next }
  }
  if (stream.type === "content_block_delta" && typeof stream.index === "number" && isRecord(stream.delta) && stream.delta.type === "text_delta" && typeof stream.delta.text === "string" && next.apiMessageID) {
    ensureMessage(writes, next, context)
    const key = `text:${next.apiMessageID}:${stream.index}`
    const partID = next.textParts.get(key) ?? context.nextPartID()
    next.textParts.set(key, partID)
    const text = (next.streamText.get(key) ?? "") + stream.delta.text
    next.streamText.set(key, text)
    writes.push({
      kind: "part",
      part: { id: partID, sessionID: context.sessionID, messageID: next.messageID!, type: "text", text, time: { start: context.now() } },
    })
  }
  return { writes, state: next }
}
```

- In the `assistant` branch, thread the api message id and positional index into `mapAssistantBlock`:

```ts
if (typeof event.message.id === "string") next.apiMessageID = event.message.id
contentBlocks(event.message.content).forEach((block, index) => mapAssistantBlock(block, index, writes, next, context))
```

- `mapAssistantBlock(block, index, …)`: text key becomes `` `text:${state.apiMessageID ?? "m"}:${blockIndex(block, index)}` `` and thinking `` `thinking:${state.apiMessageID ?? "m"}:${blockIndex(block, index)}` `` where:

```ts
function blockKey(block: ContentBlock, position: number) {
  return typeof block.index === "number" ? String(block.index) : String(position)
}
```

(delete the old length-based fallback; text part writes should set `time: { start: context.now(), end: context.now() }` as today, closing any streaming part).
- Transport: add `includePartialMessages: true` to the `sdk.query` options in `createSdkTransport`.

- [ ] **Step 4: Run FULL opencode mapper + driver test files — PASS.** Existing tests that emit `assistant` events without `message.id` still pass via the `"m"` fallback + positional index.

- [ ] **Step 5: Live verification** — start a Claude turn in the GUI, confirm narration text appears (and streams) in the transcript; confirm no duplicated text parts in the DB for the new turn:

```bash
bun -e "…query part table for the new session, count text parts vs unique ids…"
```

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/opencodex/claude-transport.ts packages/opencode/src/opencodex/claude-mapper.ts packages/opencode/test/opencodex/claude-mapper.test.ts
git commit -m "feat(claude-bridge): stream partial text so narration survives and streams live"
```

---

### Task 14: Full verification sweep

- [ ] `cd packages/opencode && bun test test/opencodex/` — all pass
- [ ] `cd packages/gui && bun test --conditions=browser test` — all pass
- [ ] Lab page: all three stages, dark + light, reduced motion (DevTools emulation), 640px width
- [ ] Live Claude session: Read titles show paths, TaskCreate rows read "Create task — …", question card shows context, auto-submit works end-to-end, dismiss confirm round-trips
- [ ] Update spec status line to "Implemented" and commit any doc deltas
