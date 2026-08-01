# GRAPH_ENG_VISUALIZER — Graph Engineering Visualizer

Handoff spec for a visual graph view of agentic loop / graph engineering workflows in the OpencodeX GUI.

**Status**: **Implemented** on `feat/graph-eng-visualizer`. All five phases are built, tested, and gated. See §13 for what was built and where the implementation deviated from this spec.
**Audience**: GUI + SDK developers picking this up cold. All file paths are real and current as of `main` (c500f942c6).

---

## 1. Problem & goal

When a session drives a multi-agent workflow — a swarm run, a background subagent fan-out, a recurring loop, or any prompted "long-term goal" that spawns child sessions — the user today only sees a flat transcript plus the swarm team strip. It is hard to understand:

- what the overall shape of the work is (which agents exist, what depends on what),
- what each edge in the workflow is trying to resolve,
- which parts have succeeded, failed, or are still running,
- and how the final output is being assembled.

**Goal**: a Graph view that renders the workflow as an interactive node/edge diagram — pan, zoom, hover for detail, click a node to read that session inline — so users can actually *see* how an agentic graph is executing and where outputs come from.

### Non-goals (v1)

- Editing the graph (adding/removing nodes, re-wiring dependencies). Read-only visualization.
- Visualizing arbitrary cross-project session trees. Scope is one root session's workflow.
- A physics/force-directed simulation. Deterministic layered layout only (see §6).
- Replacing the swarm team strip or the Swarms page. This is an additional lens.

---

## 2. Where the graph data already exists

**No new backend work is required for v1.** The orchestration graph is already in the data model; it just has no visual representation.

| Concept | Source | Notes |
|---|---|---|
| Node: session | `packages/sdk/js/src/v2/work-item.ts` — `WorkItem` (`kind: "session" \| "job" \| "swarm_run"`) | Has `parentID`, `state` (16 states incl. `failed`, `completed`, `needs_review`, `waiting_permission`), `progress {completed, failed, total}`, `startedAt`/`completedAt`/`elapsedMs`, `changedFiles`, `resourceUse`. |
| Node: job | `packages/opencode/src/opencodex/job-schema.ts` — `OpencodeXJob.Info` | `status` (`queued\|claimed\|running\|succeeded\|failed\|cancelled\|interrupted`), `parentJobID`, `sessionID`, `swarmID`, `roleID`, `attempt`/`maxAttempts`, `failure {code, message, details}`, `result`. |
| Swarm run structure | `packages/opencode/src/opencodex/swarm-schema.ts` — `OpencodeXSwarm.Info` | `roles: Role[]`, `runs: Run[]` (each with `orchestratorSessionID`, `resultSessionID`, `agents: AgentRun[]` carrying `roleID`/`sessionID`/`jobID`/timestamps). |
| Session parent→child edges | `packages/sdk/js/src/v2/client-sync-state.ts` — `selectClientSessionChildren(state, sessionID)` | Built from `Session.parentID` (`packages/core/src/session/schema.ts:37`), which is **always present on session cards** — this is the reliable edge source. |
| Role/edge intent ("what it needs to resolve") | Swarm `Role` (name, prompt/briefing via `swarm-briefing.ts`); session titles; job `source` | Child sessions are tagged `metadata.opencodex.{swarmID, swarmRole}` by `packages/opencode/src/session/prompt-swarm.ts:143`. |
| Live updates | SSE push, already wired | `subscribeEvents` → `authoritative-state-controller` → Solid signals. `workItems()` and `attentionItems()` are already exposed on the GUI's authoritative controller. No polling. |
| GUI presentation helpers | `packages/sdk/js/src/v2/swarm-presentation.ts`, `packages/gui/src/renderer/src/lib/swarm-team.ts`, `lib/session-status.ts` | `clientSwarmRuns`, `swarmTeamView`, `sessionSwarmRole`, `deriveSessionStatus`, `sessionStatusTone`. |

**Known caveat**: `state.sessions.records` is seeded from session *cards* (`OpencodeXSessionCard.Card`), which **omit `metadata`** — so `swarmID`/`swarmRole` tags are only available after a full session snapshot loads (`client-sync-state.ts:245`). `lib/swarm-team.ts` already works around this with a title-matching fallback (`childRoleKey`). **Rule for this feature: build edges from `parentID` (always present); treat swarm role metadata as progressive enrichment** that upgrades edge labels when it arrives.

---

## 3. UX specification

Terminology: the user-facing concept is **nodes** (sessions/agents) connected by **edges** (the dependency/spawn relationships). Edges carry the "what this step needs to resolve" info.

### 3.1 Entry points

Two entry points, both gated on the session being in **graph mode** (see §3.2):

1. **Workspace side tab** — a new `"graph"` tab kind in the per-session workspace panel (the right-hand tabbed panel), added to the "+" new-tab menu alongside Git / Files / Terminal / Context / Webpage. Always available from the menu; the tab itself shows an empty state if the session has no graph.
2. **In-session prompt button** — when graph mode is detected for the active session, show a dismissible affordance in the session area (a compact banner/chip near the toolbar, visually consistent with the existing swarm team strip): *"This session is running a workflow graph — **View graph**"*. Clicking it opens (or focuses) the Graph tab in the workspace panel. Dismissal persists per session (localStorage, same pattern as workspace tab state).

### 3.2 Graph-mode detection

A session is in graph mode when any of:

- it has one or more child sessions (`selectClientSessionChildren` non-empty),
- it is a swarm session (`session.model.providerID === "swarm"`, or it has associated swarm runs via `clientSwarmRuns`),
- it has associated jobs whose `source` is `swarm`, `subagent`, `schedule`, `trigger`, or `runbook`,
- any `WorkItem` chain roots at this session (`WorkItem.parentID` transitive closure).

This covers both origination paths named in the product goal: **swarm-driven** workflows and **prompt-driven** loops/long-term goals (which manifest as background subagent/job spawns). Detection is a pure function (`lib/session-graph.ts`, see §5) so it is unit-testable.

### 3.3 The graph canvas

- **Layout**: deterministic left-to-right (or top-down; pick one, recommend left-to-right for wide screens) layered DAG. Root session at layer 0; children by depth. Stable ordering within a layer (sort by `startedAt`, then ID) so the graph doesn't reshuffle on re-render.
- **Zoom**: buttons (`+` / `−` / fit-to-view) in a small floating toolbar, **and** scroll-wheel zoom centered on the cursor. Clamp zoom to ~0.25×–2.5×.
- **Pan**: click-drag on empty canvas moves the viewport. Cursor: `grab` / `grabbing`. Middle-drag also pans. (v1 does **not** support dragging individual nodes; layout is automatic. Keep the interaction model open to node-drag later.)
- **Keyboard**: arrow keys pan; `+`/`-` zoom; `0` fits to view. Canvas is focusable, nodes are tab-reachable (see §8 accessibility).
- **Minimap**: not in v1. Fit-to-view + zoom clamp covers the "see larger graphs" need; add a minimap only if real graphs outgrow it.

### 3.4 Nodes

Each node represents a session (or a job that has no session yet — e.g. queued work). Node card contents:

- **Title**: session title (or role name for swarm agents, via `sessionSwarmRole` / title fallback).
- **Subtitle**: role/kind chip — `orchestrator`, role name, `subagent`, `loop`, `job:queued`, etc.
- **Status treatment**:
  - *Running / in progress*: accent border + subtle pulse (respect `prefers-reduced-motion`).
  - *Waiting for input / permission*: warning tone (reuse `sessionStatusTone` mapping).
  - *Completed*: success-tone color shift on the card **plus a check badge in the bottom-right corner** of the node.
  - *Failed*: danger-tone color shift **plus an ✕ badge in the bottom-right corner**.
  - *Queued / dormant*: muted.
  - Status transitions animate (color transition ~220 ms, per motion tokens in `styles/themes/foundation.css`).
- **Progress**: if the node's `WorkItem.progress.total > 0`, show a thin progress bar (`completed/total`, failed segment in danger tone).
- **Selection**: clicked node gets a selected ring; selection drives the embedded session view (§3.6).

Status source of truth: `WorkItem.state` where a work item exists; else `deriveSessionStatus` (`lib/session-status.ts`); job nodes use `OpencodeXJob.Info.status` (`succeeded` → check, `failed`/`interrupted` → ✕).

### 3.5 Edges

Edges connect parent → child and carry the *intent* of the spawn:

- **Inline label** (always visible, truncated ~24 chars): the short "what this needs to resolve" — swarm role name, job source, or the first line of the child session title.
- **Hover tooltip** (rich detail card, reuse the GUI's existing tooltip/popover primitives from `components/ui`): full role briefing/prompt excerpt (from swarm role definition when available), job info (`source`, `attempt/maxAttempts`, `failure.message` if failed), timestamps, and elapsed time.
- **Edge styling by target status**: default hairline; animated dash-flow while the target node is running (again gated on `prefers-reduced-motion`); success/danger tint once terminal.
- Edges are orthogonal or gently curved bezier paths between layer columns — pick bezier, it's simpler to hand-roll.

### 3.6 Click-through: embedded session view

Clicking a node shows that session's contents **embedded in the session view**, with a way back to the "top" session:

- The session page's main transcript area swaps to a read-only embedded `TranscriptPanel` for the clicked child session (exactly the mechanism `SwarmMemberPane` in `components/swarm-team-strip.tsx` uses today — reuse it, don't reinvent).
- A prominent **"← Back to top session"** button appears in the embedded view's header (plus breadcrumb: `Top session / <child title>`); clicking it restores the root session transcript. `Esc` also goes back.
- The graph tab stays open in the side panel while browsing children; the selected node stays highlighted, so graph ↔ transcript navigation is fluid.
- Embedded child transcripts hydrate via the existing **view session hydration** path: register the child session ID through `authoritative.setVisibleSessionIDs([...])` / `syncViewSession` (see the `createEffect` in `app.tsx`). **If you skip this, child transcripts will not load.**
- A secondary action on the node (context menu or ⌘/Ctrl-click) opens the child session as a full page via `navigation.setRoute({ name: "session", sessionID })` for users who want to interact with it directly.

### 3.7 Empty / edge states

- Graph tab opened on a non-graph session: friendly empty state (use `components/ui` `ErrorState`/`LoadingState` conventions): "No workflow graph yet — spawn subagents, run a swarm, or ask for a long-term goal to see it here."
- Graph still loading (cards present, details hydrating): render nodes immediately from cards; enrich labels as snapshots land. Never block the canvas on full hydration.
- Very large graphs (>~150 nodes): render everything (SVG handles this fine at v1 scale); collapse is a v2 concern (§10).

---

## 4. Rendering approach: hand-rolled SVG (no new dependencies)

The repo has **zero** graph/canvas/charting dependencies today, and two CI gates make a library costly: `bun run check:bundle-size`, and `scripts/check-design-system.ts` (bans raw hex/rgb colors and raw px literals — much easier to satisfy with our own SVG attributes bound to `--theme-*` CSS variables than with a library's injected inline styles).

**Decision: hand-rolled SVG rendered by SolidJS.**

- One `<svg>` element; pan/zoom implemented as a `viewBox` transform (pure math, unit-testable — precedent: `lib/opencodex-logo-frame.ts` animates hand-authored SVG already).
- Nodes are `<g>` groups: `<rect>` card + `<foreignObject>` **only if needed** for text overflow — prefer plain `<text>` + manual truncation to keep it simple and lint-clean.
- All colors via `var(--theme-*)` / existing status-tone tokens; all sizing on the 4px grid tokens from `styles/themes/foundation.css`.
- Layout is a pure function (§6) — no library, no physics.

**Rejected alternatives**: `d3` (bundle + imperative DOM fights Solid), `cytoscape`/`reactflow` (React-oriented or heavy, inline-style injection fights the design-system lint), `elkjs`/`dagre` (layout-only, but our graphs are shallow trees/DAGs where a simple layered algorithm suffices; revisit for v2 if cross-links get complex).

---

## 5. Architecture & file plan

Hard constraints (CI-enforced, see `packages/gui/AGENTS.md`):
- Every authored file in `packages/gui/src/**` must be **< 500 lines** (new modules target < 400) — hence the component / controller / lib split below.
- No raw `<button>`/`<input>` outside `components/ui`; no hex/rgb; no raw px for font/padding/radius/shadow; no `!important`.
- Pure logic goes in `lib/` with unit tests in `packages/gui/test/`.

### 5.1 New files

All paths relative to `packages/gui/src/renderer/src/` unless noted.

| File | Responsibility | Est. size |
|---|---|---|
| `lib/session-graph.ts` | **Graph model builder** (pure). Input: authoritative snapshot slices (session records, work items, swarm runs, jobs). Output: `SessionGraph { nodes: GraphNode[], edges: GraphEdge[] }`. Includes `isGraphSession(snapshot, sessionID)` detection (§3.2), node status derivation, edge-label derivation with the metadata-enrichment fallback (§2 caveat). | ~250 |
| `lib/session-graph-layout.ts` | **Layered layout** (pure). Input: `SessionGraph`. Output: positioned nodes + edge paths (`{x, y, w, h}` per node, bezier control points per edge). Deterministic ordering. Also `fitViewBox(nodes)`. | ~200 |
| `lib/session-graph-viewport.ts` | **Pan/zoom math** (pure). ViewBox state, `zoomAt(point, factor)`, clamping, wheel/drag delta application, fit-to-view. | ~120 |
| `components/session-side-graph.tsx` | The Graph tab component: `<svg>` canvas, node/edge rendering, floating zoom toolbar, empty state, tooltips. | ~350 |
| `components/session-side-graph-controller.ts` | `createSessionGraphController(model, sessionID)`: memoized graph from `authoritative` signals (`createClientWorkItemSelector`, `selectClientSessionChildren`, swarm selectors), viewport signal, selection signal, hover state, `setVisibleSessionIDs` registration for hydration. | ~250 |
| `components/session-graph-node.tsx` | Single node `<g>`: card, title/subtitle, progress bar, status badge (check/✕), selection ring. Kept separate to respect line limits. | ~150 |
| `components/session-embedded-session.tsx` | Embedded child-session view for the main session area: header with "← Back to top session" + breadcrumb, read-only `TranscriptPanel`. Modeled on `SwarmMemberPane`. | ~150 |
| `styles/pages/sessions/session-graph.css` | All graph styling: node tones per status, edge strokes, pulse/dash animations (with `prefers-reduced-motion` guards), zoom toolbar. Registered in `styles.css` under `layer(features)`. | ~250 |
| `packages/gui/test/session-graph.test.ts` | Unit tests: graph building from fixture snapshots (swarm run, subagent tree, mixed jobs), detection predicate, enrichment fallback. | — |
| `packages/gui/test/session-graph-layout.test.ts` | Layout determinism, layer assignment, ordering stability, fit-view math. | — |
| `packages/gui/test/session-graph-viewport.test.ts` | Zoom clamping, zoom-at-cursor invariants, pan deltas. | — |

### 5.2 Modified files (the "add a tab kind" checklist)

This mirrors exactly how the `terminal` and `web` tab kinds were added:

1. `components/session-side-open-types.ts` — add `"graph"` to `OpenTab["kind"]`.
2. `components/session-side-open-state.ts` — `openTabLabel` ("Graph"), `openTabIcon` cases; **add `"graph"` to the `isStoredTab` allowlist** so the tab survives reload (unlike terminal, graph state is cheap to restore).
3. `components/session-side-open-tab-actions.ts` — add `addGraphTab` (singleton per session: focus existing graph tab if open rather than opening duplicates).
4. `components/session-side-tab-bar.tsx` — add a "Graph" `<Button>` to the `session-open-new-tab-panel` menu.
5. `components/session-side-open-panel.tsx` — add `<Match when={activeTab()?.kind === "graph"}>` rendering `SessionSideGraph`.
6. `components/icon.tsx` — add `graph: "Workflow"` (or `"Network"`) to the `iconNames` lucide map.
7. `lib/session-workspace-bridge.ts` — add `{ tab: "graph" }` to `SessionWorkspaceTarget` so other surfaces (and the in-session button) can open/focus it programmatically.
8. `components/session-page.tsx` (+ `session-page-types.ts`) — mount the graph-mode prompt chip (§3.1) and the embedded-session swap (§3.6). If `session-page.tsx` is near its line budget, extract the chip into `components/session-graph-prompt.tsx`.
9. `styles.css` — one `@import` line for the new CSS file.

### 5.3 Data flow

```
SSE (subscribeEvents) ─► authoritative-state-controller ─► Solid signals
                                                             │
              createSessionGraphController(sessionID) ◄──────┘
                │  createMemo: buildSessionGraph(snapshot slices)   [lib/session-graph.ts]
                │  createMemo: layoutGraph(graph)                   [lib/session-graph-layout.ts]
                │  signal:   viewport (pan/zoom)                    [lib/session-graph-viewport.ts]
                │  signal:   selectedNodeID, hoveredEdgeID
                ▼
        SessionSideGraph (svg render)          SessionPage (embedded child transcript
                                                when selectedNodeID set, via
                                                TranscriptPanel + syncViewSession)
```

Everything downstream of the SSE stream is memoized derivation — no timers, no polling, no new subscriptions. Status changes (e.g. a job flipping to `succeeded`) arrive as state updates and the memos recompute; the CSS transition handles the visual "nice color change".

---

## 6. Layout algorithm (v1)

Simple layered tree/DAG layout — do not over-engineer:

1. Root = the top session. BFS over edges to assign each node a **layer** (max depth if multiple parents — jobs with `parentJobID` can create DAG shapes).
2. Within a layer, order nodes by (`startedAt` ?? created time, then ID) — stable across re-renders.
3. Position: `x = layer * (NODE_W + GAP_X)`, `y` = ordered slot with barycenter nudge toward the mean `y` of parents (single pass is enough for v1; this keeps edges short without full Sugiyama crossing-minimization).
4. Edges: cubic bezier from parent right-center to child left-center; label anchored at the midpoint.
5. `fitViewBox(nodes)` computes the initial viewport with padding; re-fit only on explicit "fit" action or when the node count changes while the user hasn't manually panned/zoomed (a `userAdjusted` flag).

Node geometry constants (grid-aligned): `NODE_W = 208`, `NODE_H = 72` (expandable to ~88 with a progress bar), `GAP_X = 64`, `GAP_Y = 24`. Tune during implementation; keep them in `session-graph-layout.ts` so tests pin them.

---

## 7. Live status & the completion treatment

- **Success**: node card transitions to success tone; a circular badge with a check glyph fades/scales in at the node's bottom-right corner (overlapping the card edge, ~20px circle, success-tone fill, card-background check).
- **Failure**: same badge geometry, danger tone, ✕ glyph. Edge into the node also tints danger. Hovering a failed node/edge surfaces `job.failure.message` in the tooltip.
- **Partial** (a parent whose `progress` has both `completed` and `failed`): keep the parent neutral/summary-toned with a split progress bar; the badge appears only on terminal state of the node itself.
- Status mapping lives in one pure function `graphNodeStatus(node): "queued" | "running" | "input_needed" | "completed" | "failed" | "cancelled"` in `lib/session-graph.ts`, mapped from `WorkItemState` / job status / `DerivedSessionStatus` — unit-test the full matrix.

---

## 8. Accessibility

- The `<svg>` gets `role="group"` with an `aria-label` summarizing the graph ("Workflow graph: 7 steps, 4 complete, 1 failed, 2 running").
- Nodes are focusable (`tabindex`, `role="button"`, `aria-label` = title + status); `Enter` selects (same as click), arrow keys move focus to nearest node in that direction (nice-to-have; `Tab` order = layout order is acceptable for v1).
- Tooltips must be reachable on focus, not just hover.
- All animations behind `@media (prefers-reduced-motion: reduce)`.
- Status is never conveyed by color alone — the check/✕ badges and text labels carry it.

---

## 9. Implementation plan (phased, each phase shippable)

### Phase 1 — Graph model + tab plumbing (no visuals yet)
- `lib/session-graph.ts` (+ tests): build nodes/edges from fixtures covering (a) swarm run with agents, (b) plain subagent tree via `parentID`, (c) jobs with `parentJobID`, (d) metadata-missing enrichment fallback.
- Tab-kind checklist items 1–7 (§5.2) with a placeholder panel body.
- Graph-mode detection + the in-session "View graph" chip wired to `SessionWorkspaceTarget`.
- **Exit criteria**: opening the Graph tab on a swarm session logs/lists the correct node & edge set; chip appears only for graph-mode sessions; all existing tab tests still pass.

### Phase 2 — Canvas rendering + layout + pan/zoom
- `lib/session-graph-layout.ts`, `lib/session-graph-viewport.ts` (+ tests).
- `session-side-graph.tsx`, `session-graph-node.tsx`, `session-graph.css`: static render, wheel/button zoom, drag pan, fit-to-view, empty state.
- **Exit criteria**: a 20+ node fixture renders legibly; zoom is cursor-centered; layout is pixel-identical across re-renders; design-system and source-size checks pass. Verify visually in the component lab (`bun --cwd packages/gui run dev:lab` — add a lab entry with a fixture graph).

### Phase 3 — Live status + edge tooltips
- Wire controller memos to authoritative signals; status tones, badges, transitions, running-edge animation.
- Edge labels + hover/focus tooltip cards with role briefing / job failure detail.
- **Exit criteria**: running a real swarm shows nodes appearing and flipping to check/✕ live, with no polling (verify via devtools network: SSE only).

### Phase 4 — Node click-through (embedded session)
- Selection state; `session-embedded-session.tsx` with back button + breadcrumb; `setVisibleSessionIDs`/`syncViewSession` hydration; `Esc` handling; ⌘-click to open as full page.
- **Exit criteria**: clicking any child node shows its transcript in the main area within one frame of hydration; back button and `Esc` restore the top session; graph selection stays in sync.

### Phase 5 — Polish & hardening
- Accessibility pass (§8), reduced-motion, keyboard nav.
- Large-graph sanity (150-node fixture) — measure frame times while panning; memoize node subtrees if needed.
- Persistence: remember viewport + selection per session in the existing workspace-state localStorage (respect `WORKSPACE_STATE_CACHE_BYTES` budget).
- Docs: short section in `packages/gui/docs/GUI_DESIGN_SYSTEM.md` if new visual patterns (badges, canvas) were introduced.

Estimated effort: Phases 1–2 ≈ one developer-week; 3–4 ≈ one more; 5 ≈ 2–3 days. Phases 1–3 and 4 can be parallelized across two developers after Phase 1 lands.

---

## 10. Future work (explicitly out of scope for v1)

- **Node dragging** with position persistence (layout becomes "initial suggestion").
- **Collapse/expand** of subtrees for very large graphs; minimap.
- **Cross-run history**: switching between a swarm's `runs[]` to compare attempts (`swarm-presentation.ts` already exposes `clientSwarmRuns`).
- **Output lineage**: highlighting the path from a selected final artifact back through the nodes that produced it (`WorkItem.changedFiles` is the hook).
- **Graph on the Swarms page**: reuse `SessionSideGraph` standalone (it's why the model/layout live in `lib/` — they must not import session-page internals).
- **TUI parity** (`packages/opencode/src/cli/cmd/tui/…`) — likely an ASCII tree rather than a true graph.

---

## 11. Risks & open questions

| Risk / question | Mitigation / recommendation |
|---|---|
| Session cards lack `metadata` → role labels missing until hydration | Designed in (§2): edges from `parentID`, labels enrich progressively. Do not block render on hydration. |
| Loop-style workflows (repeated runs of the same goal) may look like long chains | v1: render as-is. If ugly in practice, group repeated iterations under one node with a counter (v2 collapse feature). |
| "What the edge needs to resolve" has no single canonical field for non-swarm children | Fallback ladder: swarm role briefing → job `source` + title → child session title. Documented in `lib/session-graph.ts`. |
| `session-page.tsx` line budget when adding chip + embedded swap | Extract to `session-graph-prompt.tsx` / `session-embedded-session.tsx` from the start. |
| SVG text truncation without `foreignObject` | Manual measure-and-ellipsis in the node component; test with long titles. Acceptable v1 tradeoff. |
| Should the graph also exist as a top-level route (like Views/Swarms)? | **Recommend no for v1** — the workspace tab covers the stated UX. The `lib/` split keeps a future route cheap. |
| Do queued jobs without sessions deserve nodes? | **Yes** — they show pending fan-out, which is core to "understanding what is going on". They render muted and convert to session nodes when claimed. |

---

## 12. Verification checklist for reviewers

- `bun --cwd packages/gui test` — new unit tests green, existing tab/route tests untouched.
- `bun --cwd packages/gui run check:design-system` and `check:source-size` — clean.
- `bun run check:bundle-size` — no regression (no new deps were added).
- Manual: start a swarm session, open Graph tab → nodes appear live; kill an agent → ✕ badge; complete → check badge; click node → embedded transcript; back → top session; reload app → Graph tab restored with viewport.

---

## 13. As built

Implemented on `feat/graph-eng-visualizer`. Gates at time of writing: typecheck clean, `check:source-size` clean, `check:design-system` clean **with zero new debt** (verified via the stricter `--staged` mode), 598 unit tests passing (39 new), renderer build and bundle budgets pass. No new dependencies.

### Files created

| File | Notes |
|---|---|
| `packages/gui/src/renderer/src/lib/session-graph.ts` | Types, root-ancestor walk, traversal, job fixpoint placement, counts |
| `packages/gui/src/renderer/src/lib/session-graph-nodes.ts` | **Not in the spec.** Node/edge construction and status mapping, split out to satisfy the real size gate (see below) |
| `packages/gui/src/renderer/src/lib/session-graph-layout.ts` | Layered layout, barycentre ordering + column centring, bezier edges |
| `packages/gui/src/renderer/src/lib/session-graph-viewport.ts` | Pan/zoom/fit/centre math |
| `packages/gui/src/renderer/src/controllers/session-graph-controller.ts` | App-level: graph memo, opened node, prompt dismissal |
| `packages/gui/src/renderer/src/components/session-side-graph.tsx` | The Graph tab canvas |
| `packages/gui/src/renderer/src/components/session-side-graph-controller.ts` | Viewport state + pointer/wheel/keyboard gestures |
| `packages/gui/src/renderer/src/components/session-graph-node.tsx` | Node card + tooltip |
| `packages/gui/src/renderer/src/components/session-graph-surface.tsx` | **Replaces** the spec's separate `session-graph-prompt` + `session-embedded-session`: one component owns both session-view surfaces, mirroring `SessionSwarmTeam` |
| `packages/gui/src/renderer/src/components/lab/lab-graph.tsx` | **Not in the spec.** Fixture graph in the component lab (`?page=graph`), covering every node status |
| `styles/pages/sessions/session-graph.css`, `session-graph-embedded.css` | Canvas and session-view styling |
| `packages/gui/test/session-graph.test.ts`, `session-graph-layout.test.ts` | 39 tests |

### Deviations from the spec, and why

1. **Rendering is positioned HTML nodes over an SVG edge layer, not all-SVG.** §4 called for hand-rolled SVG with manual text truncation. In practice that would have meant hand-measuring glyphs and hand-rolling focus semantics. Nodes are now `Button` primitives absolutely positioned in graph coordinates, with edges as one `<svg>` behind them, and the whole scene under a single CSS `transform`. This buys real `text-overflow: ellipsis`, design-system tokens, and native button/focus/keyboard behaviour for free. The no-new-dependency decision stands.
2. **The size limit is 400 lines, not 500.** `scripts/check-design-system.ts` flags `oversized` at `>= 400` with a baseline of 0; `check-source-size.ts`'s 500 is the looser of the two. `session-graph.ts` hit 410 and had to be split — hence `session-graph-nodes.ts`. **Treat 400 as the real ceiling for any follow-up work.**
3. **Edge labels are pointer-only; their content is repeated in the node tooltip.** Making every edge label focusable would have added a tab stop per edge. The incoming edge's intent is therefore surfaced in the target node's tooltip, which is focusable — so the information is keyboard-reachable without flooding the tab order.
4. **An empty edge detail is rendered as nothing.** Before a swarm role hydrates, the only known detail is the child's title, which is usually what the label already says. Rather than repeat it, `sessionGraphEdge` returns `""` and the canvas drops the line.
5. **Status text mixes toward `--text`.** The raw `--success`/`--danger` tokens are tuned for the plain panel; on the tinted node backgrounds they measured 4.04:1 in the light theme, under the AA floor for body-size text. Measured after the fix: light 6.3–8.0, dark 7.5–9.4.
6. **Both embedded panes were made mutually exclusive** at the composition layer (`app-session-routes.tsx`), since the swarm member pane and the graph node pane both own the session's main area.

### Carried forward unchanged

The §2 hydration landmine was real: opened nodes are registered through `setVisibleSessionIDs` / `syncViewSession` in `app.tsx`, without which the embedded transcript stays empty. Edges are built from `parentID` with swarm roles as enrichment, exactly as specified. Everything in §10 remains future work; node dragging, collapse, and a top-level route were not built.

### Round 2: the catalog hides the delegation tree

Live testing with a real swarm exposed a wrong assumption in §2: `parentID` does ride on session cards, but **swarm-delegated children never become cards at all**. `renderableSessionWhere()` (server, `packages/opencode/src/opencodex/session-filter.ts`) and `isClientSessionRenderable` (client, `packages/sdk/js/src/v2/client-sync-cards.ts:95`) both drop any session whose `metadata.opencodex.swarmID` is set — including from live `session.created`/`session.updated` events. The graph *and* the swarm team strip were reading only the catalog, so both were blind to exactly the sessions they exist to show.

Fixes, all on `feat/graph-eng-visualizer`:

- **Descendant fetching** (`lib/session-graph-fetch.ts`, `controllers/session-graph-controller.ts`): the graph controller BFS-walks `/session/{id}/children` (unfiltered on the server) from the selected session, bounded at depth 6 / 200 sessions, and merges the result with the catalog (`mergeSessionLists`, newer `time.updated` wins). Structure refetches are event-driven: a `session.created/updated/deleted` whose id or parentID is in the known tree schedules one debounced (400 ms) refetch. Status churn never refetches — `session.status` events are applied into `snapshot.sessionStatus` by id regardless of catalog visibility (`client-sync-events.ts`), so live "running" state flows reactively; `buildSessionGraph` now accepts `sessionStatus` for exactly this.
- **Team strip shares the tree**: `createSwarmTeamController` takes `extraChildren` (the graph's descendants), so role pills gain runs and light up for real swarm delegations.
- **Hydration guard** (`lib/session-hydration.ts` + `lib/session-graph-visibility.ts`): the guard that drops loaded transcripts for sessions missing from the snapshot now also accepts graph-fetched sessions — previously an opened swarm-child node loaded its transcript and threw it away.
- **Full-page open guard** (`app-session-routes.tsx`): ctrl-click on a node whose session is not in the catalog stays embedded instead of routing to a page that cannot resolve it.
- **Task tool** (`packages/opencode/src/tool/task.ts`): (a) a swarm session's specialists keep their own `task` tool, so a role can fan work out to subagents of itself — their children do not inherit it, keeping default fan-out one level deep; (b) the result extraction now skips synthetic parts, surfaces assistant errors (`The subagent failed: ...`), and labels empty output explicitly instead of returning `""` — the silent-empty-result failure mode observed in testing.

Delegation-path note for testers: a Claude Code orchestrator delegates via `mcp__opencodex_swarm__delegate` (children titled `<Role> (swarm role)`, tagged with `swarmRole`); any other orchestrator is briefed to use the task tool (children titled `... (@<agent> subagent)`, tagged with `swarmID` only — role bucketing falls back to title matching, so briefed orchestrators should lead the description with the role name, which the briefing already instructs).

### Round 3: a standing invitation is not worth a screen row, and freezes get a floor

Two things came back from live use.

**The "View graph" banner was sized by a grid bug.** `.session-workspace` spells out `grid-template-rows` for each combination of optional headers. With the swarm strip *and* a member pane on screen, the prompt landed in the `minmax(0, 1fr)` track and stretched to roughly half the viewport. Rather than patch the track list a fourth time, the invitation moved to where a standing action belongs: an icon button in the session toolbar (`session-toolbar.tsx`), always present for any session, no longer gated on `sessionGraphAvailable` and with no dismissal state to remember — a session with one node opens a graph that says so. `graphPromptVisible` / `dismissGraphPrompt` and the `promptDismissed` localStorage key are gone; `SessionGraphSurface` now owns only the opened-node pane.

**The freeze got a structural floor rather than another point fix.** The round-2 freeze was a genuine cycle (an effect that both read and wrote the viewport). This round's report — clicking a second specialist in the strip — could not be reproduced: a Playwright fixture driving a real backend through a real swarm (three roles, a multi-run specialist, seeded transcripts, a second-generation child, live churn) holds a steady ~60 fps across every switch, with and without the graph canvas mounted (`e2e/swarm-team-strip.spec.ts`, which now asserts painted frames, not just that locators resolve). What a probe *did* confirm is the mechanism: an effect whose two runs disagree spins Solid's queue synchronously, with no ceiling, and the renderer stops painting entirely.

So the guarantee is now enforced instead of argued. `lib/stable-effect.ts` bounds synchronous re-runs per flush (a microtask cannot fire mid-spin, which is exactly what makes the counter a reliable spin detector), stops the body past the limit, reports the offending effect by name, and wakes it on a *timer* with geometric backoff — a microtask resume would starve the event loop just as thoroughly as the spin. Waking matters as much as stopping: skipping the body permanently would drop the effect's subscriptions and leave its pane dead. `createStableEffect` now wraps the effects on these flows that legitimately write state they also depend on:

`sessionGraph.closeMissingNode`, `swarmTeam.closeMissingMember`, `sessionPage.clearMemberWhenBlocked`, `transcript.loadingSkeleton`, `transcript.collapseWindow`, `transcript.warmSession`.

Separately, `app.tsx` now `untrack`s the embedded-pane hydration call. `syncViewSession` synchronously reads the very pane state it then writes (loading flags, loaded timestamps, cached transcripts), so tracking those reads subscribed the effect to its own writes; what it must react to is *which* sessions are embedded, which is still tracked.

The breaker is a floor, not a diagnosis: if a freeze recurs, the console now names the effect that caused it.

### Round 4: one root cause behind three symptoms, and the graph gets depth

Reported: the run picker and "Back to orchestrator" collide; specialist prompts are invisible; the pane flashes and never shows live output; graph tooltips are see-through; cards do not reliably read "running"; some specialist views render blank; and the graph is only ever one fan-out with a single merge.

**Blank panes, missing prompts, and the flashing were all the same bug.** `reconcilePresentation` (`authoritative-state-controller.ts`) reconciles the presentation cache against `selectClientKnownSessionIDs(state)` — the client catalog — and evicts anything missing. Swarm-delegated children are hidden from that catalog *by design*, so every catalog change declared them deleted: it aborted the in-flight transcript load and dropped the loaded data. A probe caught it exactly — `{data: false, visible: false}` on a load that had already returned 200. Blank when the abort landed first (with nothing scheduled to retry, so it stayed blank), a flash when the eviction landed after (data → empty → reload), and no prompt to read either way. `reconcilePresentation` now unions the catalog with `graphVisibleSessionIDs()`, the same registry the hydration guard already consulted. The two embedded panes also gained `loadOlderMessages`, so the delegation prompt at the top of a long specialist run is reachable rather than trimmed away by the 48-message view window (and `loadOlderViewSessionMessages` learned the same catalog caveat).

**Tooltips were transparent app-wide, not just in the graph.** `tooltip-v2.css` reached for `--background-bg-layer-01` and `--elevation-floating`; the design system defines `--v2-background-bg-layer-01` and `--v2-elevation-floating`, as its sibling `menu-v2.css` correctly uses. Neither unprefixed name is defined anywhere in the repo, so both declarations were invalid and every v2 tooltip rendered with no background and no shadow — invisible over anything but flat panel. Fixed at the source.

**"Idle" was the wrong reading of a returned delegation.** A swarm child has no work item and no job — the catalog hides it — so nothing tracks it but its own session status, which is cleared the moment it stops. `resolveStatus` mapped that to `idle`, which was wrong twice over: the card claimed nothing had happened, and `idle` is not terminal, so the parent's merge node sat on "Waiting on branches" for the session's lifetime — the fan-in from round 3 could never actually complete. A delegated session exists only because a parent created *and* immediately prompted it, so "not running" now reads as `completed`. Honest limitation: without a work item there is no record of *how* it ended, so a subagent that errored still reads completed; the transcript behind the node is where the failure shows.

**Depth was capped at one hop, by this project's own doing.** Round 2 granted the task tool to a swarm session's specialists but not to their children, which made every swarm a star: orchestrator, one layer of specialists, one merge. Real graph engineering is layered — a builder hands output to a reviewer, the reviewer hands corrections back down. Membership now rides on the child's own metadata (`swarmID` + `swarmDepth`) rather than being re-derived from "is my parent the orchestrator", so it survives past the first hop: a specialist two layers down still resolves swarm roles, still tags its children, and still appears under the right team member instead of "Other agents". Delegation is allowed to `MAX_SWARM_DELEGATION_DEPTH` (4) hops and stops there rather than recursing forever. The orchestrator briefing now says to design in layers explicitly.

Scope note: specialists are not handed the full team roster, so a hand-off happens because the orchestrator names the next role in the specialist's prompt — which is what the briefing now instructs. Giving every role the roster is the obvious follow-up if hand-offs should be self-directed.

### Round 5: a swarm must not spawn swarms

**A delegated child could be routed to the swarm facade itself.** Model resolution ended `?? { providerID: msg.info.providerID, modelID: msg.info.modelID }` - the caller's own model. For an orchestrator that value *is* the facade, so any delegation whose role failed to resolve produced a child on `swarm/<id>`. `prompt-swarm.ts` decides a session is an orchestrator from exactly that (`isSwarmProvider(last.info.model.providerID)`), so the child was handed a briefing and a team and started delegating instead of doing the work - recursively, and with an empty transcript to show for it. `task.ts` now refuses to route any subagent to the facade: it resolves the concrete model that facade stands for (the orchestrator role's own), falls back to the subagent agent's model, and fails loudly rather than silently producing a swarm-in-a-swarm.

The companion rule: inside a swarm, a role spawning helpers of itself runs them on **its own** model rather than falling through to whatever its subagent agent configures. Role hand-offs still win over both - delegating to "Senior Engineer" uses that role's model, which is what makes a layered graph route correctly.

**Layered graphs were verified, not assumed.** `test/session-graph-layers.test.ts` builds the shape by hand - orchestrator → Designer drafts → Senior Engineer builds → Designer validates - and asserts one column per layer, roles travelling with each hand-off, merges nesting inward (`join:build` → `join:draft` → `join:root`), an unfinished layer holding every merge above it open, and a fan-out inside a layer still fanning into that layer's merge. All seven passed on the first run: the graph model already handled arbitrary depth, and the only thing that had ever capped it was the backend's delegation rules.

### Round 6: a pane that cannot explain itself

"Open this step as a full session" appeared to do nothing. It was routing correctly - but the opened graph node survived the route change (the step is still a node in the *new* session's own graph), so the embedded pane stayed mounted over the page that had just been navigated to. `openGraphNodeFullPage` now closes the embedded pane before navigating.

The blank pane got two things it was missing. `syncViewSession` rejected into the caller's `void` when a transcript load failed, so the pane sat empty with nothing to explain it and nothing scheduled to retry - indistinguishable from a step that genuinely had not said anything. View pane state now carries an `error`, and `EmbeddedSessionStatus` renders either "could not load this step" with a **Try again** (a forced re-sync, the only way back once a load has failed) or "nothing here yet - this step has not produced any messages". Both embedded panes use it.

Worth recording for the next reader: `snapshot.sessions` and `selectClientKnownSessionIDs(state)` are *not* the same set. Swarm-delegated children appear in the first and not the second, which is why the round-4 presentation eviction bit while the full-page route resolved them fine. A check against the wrong one of those two is the shape of bug to look for here.

### Round 7: the graph was drawing the spawn tree, not the pipeline

A relay session - three designers, merge, three engineers, merge - rendered as a star: one column of nine siblings and a single merge. Querying the session settled why. Every child had `parent_id` = the orchestrator. `parentID` records *who spawned a step*, not *what it waited for*, and an orchestrator that runs the whole relay itself never nests anything. The graph was faithful to its input; its input was the wrong relation.

The ordering is in the timings, and recoverable by a rule rather than a threshold: **work delegated while earlier work is still running is concurrent; work delegated after all of it stopped is the next stage.** A fan-out is issued in one turn, so its siblings overlap. A follow-on step cannot be issued until its inputs are back, so it cannot overlap. Measured against the relay session, the gaps split cleanly - siblings 2.8s/3.3s/9.2s/9.3s apart and overlapping, stage boundaries 41.7s/15.6s/16.6s *after* the previous step ended - and the rule reproduces the intended pipeline with no timing constant in it.

`session-graph-stages.ts` groups a session's children into stages this way. `session-graph-place.ts` replaces the breadth-first sweep with a walk: each stage begins one column past whatever the previous stage ended in, and a child's own subtree is placed before its stage closes, so nested hand-offs compose with staged fan-outs. `session-graph-join.ts` builds one merge per stage instead of one per parent - a stage of two or more earns a merge and the next stage flows out of it, a stage of one flows straight on, and the final stage always merges because that is where the delegating session gets its work back.

Two consequences worth knowing. Node emission order is now depth-first, so any assertion on `nodes` order has to sort - only `depth` is meaningful. And a pipeline is much wider than a spawn tree, so it no longer fits the side panel at a readable zoom; fit-to-view clamps and the reader pans. A wide-graph reading mode is the obvious follow-up.

The heuristic's limit, stated plainly: it reads "started after the last one finished" as a dependency. An unrelated step delegated late still opens a new stage, because nothing in the data distinguishes "next" from "also, later". Recording real dependencies at delegation time would be exact, and would only help sessions run after it shipped.
