# Question/Permission Card Redesign + Transcript Visibility Fixes

Date: 2026-08-09 (evening session)
Status: Draft — awaiting user review
Session: `ses_0166d4791ffeTkk8gn6DyUQXwz` ("OpencodeX question/response widget review")

This spec has two halves:

- **Part A** — the approved redesign of the safety dock's question/permission cards.
- **Part B** — root-caused fixes for three transcript display bugs discovered mid-design,
  including *why the user could never see the plans this design process produced*.

---

## Part A — Safety dock redesign (approved direction: "Refined choice tiles")

### A1. Slim header (both card types)

One ~40px strip, keeping the tone-tinted background:

- Icon (22px) · a single label — **"Question"** or **"Permission Request"** — · pagination
  pill (unchanged) · **X dismiss icon button** on the far right.
- The current two-line eyebrow (`QUESTION` label + h2 topic) in `SafetyCardHeader` is
  deleted. No sub-header. Everything else moves into the body.
- Question card body: the question text itself is the headline — 16px, weight 600,
  line-height 1.4, top of body. The per-question topic (`header`, e.g. "Auth method") is
  dropped from the chrome (still used for `aria-label`s).
- Permission card body: the request title ("Run bash command") renders at the top of the
  body above the command/diff.

### A2. Answer tiles

Each option becomes a bordered full-width tile (currently flat ghost rows, 2px gaps):

- 1px `--ds-border-subtle` border, control radius, ~10px vertical padding, 6px gaps.
- Numbered keycap chip (existing `kbd`), hover = stronger border + faint raise + keycap
  highlight.
- Selected = accent border + ~8% accent fill; keycap flips solid accent. Multi-select
  tiles show an animated check on the trailing edge.
- Tiles cascade in with a ~20ms stagger on step entry; steps transition with a
  ~160ms slide+fade. All motion honors `prefers-reduced-motion`.

### A3. Auto-submit flow (no footer bar)

- **The question card has no footer.** Dismiss/Reply buttons and the "n of m answered"
  text are gone; the header pill already carries position.
- **Single-select:** clicking a tile locks the selection, plays a ~200ms confirmation
  pulse, then — if that answer **completes the whole request** → auto-submit; otherwise →
  slide to the next *unanswered* question. ("Completes the request", not "is the last
  step": answering Q1 last after paging ahead submits.)
- **Multi-select:** toggles freely. Once ≥1 chosen, a compact inline confirm appears
  right-aligned under the options — "Next →" if other questions remain unanswered,
  "Send answers ⏎" if this completes the request. Enter does the same.
- **Custom answer:** the labeled TextField becomes a quiet tile-styled row at the end of
  the list ("Type your own answer…") that expands on focus. Enter behaves like a
  single-select choice. Ctrl/Cmd+Enter force-submits when complete.
- **Keyboard:** 1–9 select, ←/→ page, Enter confirms, Escape opens the dismiss confirm
  (no more instant reject).

### A4. Dismiss X + confirm modal (full parity)

- X icon button top-right on **both** card types; ghost style, danger tint on hover.
- Opens the existing `ui/dialog.tsx` `Dialog` (size `sm`, scrim/focus-trap/restore built
  in):
  - Question: "Dismiss this question?" — body explains Claude proceeds without input.
    Buttons: **Cancel** (default focus) · **Dismiss** (solid danger).
  - Permission: "Reject this request?" — Buttons: **Cancel** · **Reject**.
- Permission footer keeps only **Always allow** + **Allow once**; Reject moves into the X.
  Keyboard `3` / Escape route through the confirm modal.
- Dialog backdrop (z 20) already stacks above the dock (z 15) — no z-index work.

### A5. Show the model's content with the question

The card must never ask for a decision without the material needed to make it (see
Part B, finding 3 — today the accompanying prose frequently *does not exist* client-side):

- The question card gets a scrollable, markdown-rendered **context section** above the
  question headline, fed by the most recent visible assistant text in the same turn,
  when present.
- When a question/permission arrives, auto-scroll the transcript to the latest assistant
  message.
- Because the accompanying text can be lost upstream (Part B), the card must render the
  full question payload well: long `question` strings (multi-paragraph, markdown) must
  display cleanly, not truncate.

### A6. Files touched (Part A)

- `packages/gui/src/renderer/src/components/session-question-card.tsx`
- `packages/gui/src/renderer/src/components/session-permission-card.tsx`
- `packages/gui/src/renderer/src/components/session-safety-card.tsx` (header rewrite)
- `packages/gui/src/renderer/src/components/session-safety-dock.tsx` (next-unanswered)
- `packages/gui/src/renderer/src/lib/safety-present.ts` + `packages/gui/test/safety-present.test.ts`
  (new helpers: `requestCompleteWith`, `nextUnansweredStep`)
- `packages/gui/src/renderer/src/styles/global/overlays/safety.css`, `safety-detail.css`
- `packages/gui/src/renderer/src/components/lab/lab-safety.tsx` (stage copy + context mock)
- New shared `SafetyDismissConfirm` component using `Dialog`.

---

## Part B — Transcript visibility findings (root-caused 2026-08-09)

### Finding 1 — Read rows never show the file (CONFIRMED)

**Root cause:** key-shape mismatch at the Claude bridge. `claude-mapper.ts` stores the
CLI's raw tool input, where Read uses `file_path`. The transcript title builder
(`tool-title.ts`) reads `input.filePath` (OpenCode-native spelling) → every Claude read
titles as "Read file". Verified in the session DB: native-driver sessions store
`{"filePath": …}`, Claude-driver sessions store `{"file_path": …}`.

The permission layer already normalizes this (`claude-permission.ts:186` — "The read
card reads `filePath`; Claude spells it `file_path`") — the transcript mapper never got
the same treatment.

**Also:** `mapToolResult` hardcodes `metadata: {}`, and `toolHasVisibleDetails("read")`
requires `metadata.preview` — so Claude reads *never* have expandable details; grouped
"Read files" rows expand to a list of context-free "Read file" lines.

**Fix:**
1. Normalize tool input in `claude-mapper.ts` at write time (share the existing
   normalization used by `claude-permission.ts`) so stored parts match native shape.
2. Make `read`/`write`/`edit` title builders tolerant (`filePath ?? file_path`) as
   defense in depth.
3. Synthesize `metadata.preview` for read results from the tool output (first N lines)
   so the expander shows the file content preview like native reads.
4. Unit tests in `packages/opencode` pinning `file_path` → titled reads, and in
   `packages/gui` for the tolerant title builder.

### Finding 2 — ToolSearch / TaskCreate / TaskUpdate rows are useless (CONFIRMED)

**Root cause:** these harness tools aren't in the mapper's `TOOL_NAMES` map nor the GUI's
`TOOL_TITLE_BY_ID` registry. They normalize to `toolsearch` / `taskcreate` /
`taskupdate` and title via `humanizeToolTitle` → "Toolsearch", "Taskcreate" — with only
a raw-JSON expander.

**Fix:** add title builders + detail presentation:
- `toolsearch` → `Search tools "select:TaskCreate,TaskUpdate"` (from `input.query`).
- `taskcreate` → `Create task — <subject>`.
- `taskupdate` → `Update task #<id> — <status/changes>`.
- `tasklist` / `taskget` → `List tasks` / `Task #<id>`.
- Body details: render the interesting fields (query/results count; subject +
  description; status transitions) instead of raw JSON. Output text from these tools is
  short and meaningful — surface it.
- Same sweep for other harness tools seen in transcripts: `agent` (Agent), `monitor`,
  `schedulewakeup`, `workflow` — verb-first titles from their inputs.

### Finding 3 — The plan text is invisible (CONFIRMED at the OpencodeX boundary)

**What the user experienced:** the model asked approval questions about a plan the user
could never see.

**Evidence chain (this very session):**
- OpencodeX DB: the entire design turn (`msg …1MFItRqH`, 06:38–06:50) stored exactly
  **one** 95-char text part; the multi-thousand-char design messages are absent.
- Claude Code's own transcript (`~/.claude/projects/C--Work-OpencodeX/4f1779c3….jsonl`)
  contains only **three** assistant text blocks for the whole conversation — the same
  three short ones OpencodeX has. The long design prose appears **nowhere** — not in
  OpencodeX, not in Claude's own record.
- Every AskUserQuestion-bearing API message has the shape
  `[thinking, thinking, tool_use]` — and the second thinking block's signature size
  tracks the length of the "missing" prose (e.g. ~4.5k-char plan → `sig=4476`).
  Thinking content is stripped/encrypted (`thinking: ""`, signature only) in both the
  SDK events and the CLI transcript.

**Conclusion:** the accompanying prose is emitted/recorded as (encrypted) *thinking*,
not text, in this model+CLI configuration. OpencodeX cannot render content it never
receives. This is upstream of OpencodeX (CLI/SDK/model channel allocation), but
OpencodeX must be robust to it.

**Fixes (OpencodeX side):**
1. **Render plans as first-class transcript items.** `plan_exit` (ExitPlanMode) tool
   input carries the full plan markdown — render it as an expandable card (user's
   preferred option) and offer "Open as file" into the workspace side panel. When a
   question follows a plan, the question card links to that plan item.
2. **Part A §A5** — question cards render their full payload well and pull in the last
   visible assistant text when it exists.
3. **Experiment:** enable `includePartialMessages` in `claude-transport.ts` and check
   whether `stream_event` text deltas surface prose that final events lose. If yes,
   assemble text parts from deltas (also gives live streaming text).
4. **Report upstream** with the evidence above (assistant text blocks absent from the
   CLI's own transcript when co-emitted with AskUserQuestion under
   effort/interleaved-thinking).
5. **Convention for agents** (docs/AGENTS.md note): put decision-critical content in
   the `question` field itself or in a committed file — never rely on turn-middle prose.

### Verification plan

- Unit: mapper normalization tests; title builder tests; `safety-present` helpers.
- Visual: lab page `lab.html?page=safety` — three stages, dark/light, reduced motion.
- Live: a scripted Claude turn exercising Read/ToolSearch/TaskCreate + a question, then
  confirm titles, expanders, plan card, and question context render.
