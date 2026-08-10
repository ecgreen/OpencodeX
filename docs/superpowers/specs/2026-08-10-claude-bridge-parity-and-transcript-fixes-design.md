# Claude Bridge Parity & Transcript Fixes — Design

**Date:** 2026-08-10
**Status:** Approved (pending user review)

## Problems

All four were root-caused against live evidence (session `ses_0137cad30ffe…`,
a live SDK stream trace, and the stored message database).

1. **Todo lists never render in Claude sessions.** The GUI's todo widget
   (transcript `ToolTodos` + inspector "Todo" section) is fed exclusively by
   the `todowrite` tool: `claude-mapper.ts` emits `{ kind: "todos" }` only for
   `todowrite`, and newer Claude Code harnesses steer models to
   `TaskCreate`/`TaskUpdate` instead. Those arrive as inert one-line tool
   parts ("Update task #1 — in_progress"). OpenAI-driven sessions still use
   native `todowrite`, so they render correctly.
2. **Assistant output doubles in the transcript.**
   - **(a) Streamed/final part duplication.** Commit `3c7f9d1` keys streamed
     text parts by true stream index (`text:<apiMsgID>:<index>`), but the CLI
     emits one `assistant` event per content block whose blocks carry **no
     `index` field** — so the final-event path keyed by array position
     (always 0). Thinking occupies index 0, text index 1 → two parts per text
     block. Commit `b8953ce` added `reconciledKey` (content-equality rescue),
     verified correct against real event shapes by simulation. Doubles
     recorded *after* that commit came from a sidecar process still running
     pre-fix code. Remaining work: a pinned regression test with the exact
     real shapes, and an operator note that the sidecar must restart.
   - **(b) Queued user messages are swallowed** (discovered during
     investigation; the worse half). Messages sent while a turn is running
     queue as session commands, but `prompt-swarm.ts` `claudeCodeTurn()`
     builds every Claude turn from `lastUserMessage(sessionID)`. Three queued
     messages produced three turns, each delivering only the *newest*
     message's text; the first two were stored but never reached the model.
3. **Session graph stays empty when Claude spawns subagents.** The graph
   renders child sessions (`session.parentID` chains). Claude's subagents run
   as SDK sidechains inside the CLI; `parent_tool_use_id` is handled nowhere
   in the codebase, so no child sessions exist — and sidechain events are not
   even filtered, so subagent output can be misattributed to the main
   transcript.
4. **Very long terminal commands wrap the tool row onto extra lines.**
   `.part-header` uses `flex-wrap: wrap`; when the `.part-meta-command` echo
   is long, the flex line wraps instead of truncating.

## Scope

`packages/opencode` (claude bridge, session prompt loop) and `packages/gui`
(one CSS fix). The OpenAI/native paths are untouched — they already work.

## Design

### 1. Map Claude task tools into the built-in todo system

In `claude-mapper.ts`:

- Add a task registry to `MapperState`: `tasks: Map<string, { subject: string; status: string }>` (insertion order = display order).
- Seed it across turns: the claude conversation record (which already
  persists `claudeSessionID`, `modelID`, `billed`) gains a `tasks` array;
  the driver passes it into `initialState` and saves the post-turn registry
  back.
- On tool completion (`mapToolResult`):
  - `taskcreate`: register `{ subject: input.subject, status: "pending" }`.
    The task id comes from the result text (`/Task #(\w+) created/`); if the
    parse fails, fall back to a sequential local id — ids only need to be
    stable within the session.
  - `taskupdate`: apply `input.status` / `input.subject` to the registry
    entry (`taskId`); `status: "deleted"` removes it.
  - After any change, emit the existing `{ kind: "todos", todos }` write with
    the full registry (status vocabulary already matches:
    `pending`/`in_progress`/`completed`).
- Transcript widget: when emitting the tool part update for a completed
  `taskcreate`/`taskupdate`, attach `metadata.todos` (the same projected
  list) — `toolHasRichDetails` already renders `ToolTodos` from
  `metadata.todos`, so the transcript shows the full stepper widget with no
  GUI change.
- `tasklist` results are NOT parsed (output format is for humans; the
  registry is authoritative). `taskget` is ignored.

### 2a. Doubling: regression pin + operator note

- Add a mapper regression test using the exact real-world shapes captured in
  the live trace: `message_start` → thinking deltas at index 0 → per-block
  `assistant` event with **stripped-empty** thinking and no `index` field →
  text deltas at index 1 → per-block `assistant` event with the full text,
  no `index` field, single-element content array. Assert exactly one
  reasoning part and one text part.
- No mapper logic change is expected (`reconciledKey` passes this today);
  the test pins it against regression.
- Document in `DEV_README.md`: mapper fixes require restarting the sidecar
  process (long-lived dev sidecars keep serving stale code).

### 2b. Deliver each queued message, not the newest one three times

- `claudeCodeTurn(sessionID)` becomes `claudeCodeTurn(sessionID, messageID)`:
  the caller in `prompt.ts` passes the prompt input's message id (the message
  the claimed command belongs to). The turn's `text` and `parentMessageID`
  come from **that** message, not `lastUserMessage`.
- Routing decisions (model/provider/variant, swarm detection) also read the
  command's message rather than the newest one, so a queued message keeps the
  model it was sent with.
- No concatenation of other pending messages: the command queue already runs
  one turn per queued command in order; with per-command message threading,
  each message is delivered exactly once, in order.
- Unit test: two queued commands for distinct messages → two driver
  invocations, each with its own message's text and `parentMessageID`.

### 3. Project Claude sidechains into child sessions

New module `packages/opencode/src/opencodex/claude-sidechain.ts`, used by the
driver:

- The driver partitions incoming events by `parent_tool_use_id`:
  - absent → main mapper (today's path).
  - present → per-sidechain pipeline keyed by that id.
- First event for a new sidechain id creates a real child session via the
  session service: `parentID` = main session, title from the spawning Task
  tool call's input (`description` ?? `subagent_type` ?? "Claude subagent"),
  plus a synthetic user message carrying the Task `prompt` so the child
  transcript reads correctly. Each sidechain gets its own `MapperState` +
  `MapperContext` (child session id, its own message ids) and its writes
  apply to the child session.
- The sidechain finishes when the main conversation's `tool_result` for the
  spawning call id arrives: finalize the child mapper
  (`finalizeAbandonedTurn` semantics for still-open parts), mark the child
  session idle.
- Effect: the session graph populates (child sessions with `parentID`), the
  side panel's session tree shows live subagents, and sidechain content can
  no longer leak into the main transcript (events with `parent_tool_use_id`
  never reach the main mapper).
- Limitations (accepted): tokens/cost stay attributed to the main session
  (the SDK reports only turn totals); nested sidechains (a subagent's own
  subagents) parent to the main session rather than to their true parent —
  the SDK does not chain parent ids.
- Unit tests: event partition routing; child-session lifecycle (create on
  first event, finalize on tool_result); no main-transcript writes for
  sidechain events.

### 4. Single-line tool rows: truncate long commands

In `transcript-part.css`:

- `.part-header`: `flex-wrap: nowrap`.
- `.part-meta`: allow it to shrink on the single line (`flex: 0 1 auto` with
  the existing `min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap`), so a long command truncates with `…` instead of
  wrapping the row.
- The full command remains reachable: the meta already carries a native
  `title` tooltip, and expanding the row shows the complete invocation in the
  details body. No component changes.
- Verify adjacent header slots (status chip, error preview) still fit; they
  are `white-space: nowrap` already and sit after the shrinking meta.

## Testing

- **Unit (bun, packages/opencode):** task-registry accumulation and todos
  emission (create/update/delete, id parse fallback, cross-turn seeding);
  per-command message threading; doubling regression with real event shapes;
  sidechain partition + lifecycle.
- **Manual/e2e:** a Claude session using TaskCreate/TaskUpdate shows the todo
  widget in transcript and inspector; three messages queued during a long
  turn each get their own answer; a Claude session spawning subagents
  populates the session graph; a long `bash` command renders as one
  truncated row that expands to the full command.
- **Operator:** restart the running sidecar after deploying (2a).
