# GRAPH_PLAN — Goals, graphs, and loops for agent engineering

How OpencodeX gets from "a model that delegates when it feels like it" to
**goal-driven agent engineering**: the user states a goal, the system builds a
task graph, a dispatcher walks it — delegating each node to the right executor
automatically — and loops iterate until the goal's exit criteria hold. The same
machinery serves swarms (a team behind one model id) and non-swarms (a single
agent grinding on a goal), because both reduce to *executors attached to graph
nodes*.

---

## 1. Vocabulary

| Term | Meaning |
|------|---------|
| **Goal** | A user-stated outcome with explicit success criteria. The root object; owns one graph. |
| **Graph** | A DAG of nodes with dependency edges. The plan artifact — inspectable before and during execution. |
| **Node** | One unit of work: a `task`, a `check` (verifies something), a `loop` (bounded cycle over a subgraph), or a `synthesis` (merges results). |
| **Executor** | What runs a node: a swarm role, a named agent, or a bare model+skill combo. This is the swarm/non-swarm unifier. |
| **Loop** | A node whose body re-runs until an exit condition holds: a check passes, results converge ("dry"), or a budget/iteration cap trips. Loop engineering is the one-node degenerate case of graph engineering. |
| **Gate** | A node that blocks until a human approves. Rides the existing attention surface. |

## 2. What already exists (and is reused as-is)

The plan deliberately builds on live machinery rather than inventing parallel
infrastructure:

- **Delegated execution.** `runSwarmRole`
  ([prompt-swarm.ts:124](packages/opencode/src/session/prompt-swarm.ts)) runs a
  specialist as a child session on its own model, delivering
  `skill body + role instructions + task` and returning the report. This is
  already the "execute one node with executor E" primitive; the dispatcher
  calls it instead of the orchestrator model choosing to.
- **Observability.** Child sessions carry
  `metadata.opencodex.{swarmID, swarmRole}`; the session page's team strip
  ([swarm-team-strip.tsx](packages/gui/src/renderer/src/components/swarm-team-strip.tsx))
  already click-throughs into each child's transcript, whose first message *is*
  the delivered prompt. The graph view generalizes this, it does not replace it.
- **A durable job queue.** `OpencodeXJob` already has leases, `attempt` /
  `maxAttempts`, `timeoutAt`, `cancelRequestedAt`, `parentJobID`, `swarmID`,
  `roleID`, `idempotencyKey`, and a `source` enum that already names
  `"schedule" | "trigger" | "runbook"`. **Every node execution is a job.**
  Retry, lease-expiry recovery, cancellation, and attention on failure come for
  free — the graph layer never reimplements them.
- **Skills and role templates.** Built-in role skills
  (`skill/prompt/roles/*.md`) and user-defined roles (name + pre-prompt, GUI
  library) define *what an executor is*. A node references an executor; the
  executor definition supplies the prompt layers.
- **Attention.** `projectAttentionItems` + the attention queue already surface
  "needs input / failed" items per project. Gates and failed nodes plug into
  this rather than growing a second inbox.
- **Legacy fossils.** `swarm-run.ts`, `swarm-execution.ts`,
  `swarm-reconcile.ts`, `swarm-plan-layer.ts`, and the `Run`/`AgentRun` rows on
  `OpencodeXSwarm` are the previous, pre-"swarms-are-models" orchestration
  engine — dead from every UI. They prove the statuses and reconcile loop this
  needs, but they model *runs of a swarm*, not *graphs of a goal*. **Decision:
  replace, don't salvage** — and delete them in the final phase so the codebase
  never carries two orchestration engines.

## 3. The core model

```
Goal
 ├─ statement            what the user wants, in their words
 ├─ successCriteria[]    checkable claims ("tests pass", "review finds no P1s")
 ├─ ownerSessionID?      the chat session that created it (absent for standing goals)
 ├─ budget?              token/cost/wall-clock caps
 └─ Graph
     ├─ Node
     │   ├─ kind         task | check | loop | synthesis | gate
     │   ├─ title, brief             what to do, in the planner's words
     │   ├─ executor     { swarmRoleID } | { agent } | { providerID, modelID, skill?, instructions? }
     │   ├─ status       planned | ready | dispatched | running | done | failed | skipped | awaiting_approval
     │   ├─ jobID?       the OpencodeXJob executing it (attempt N lives on the job)
     │   ├─ sessionID?   the child session that ran it — the transcript IS the audit trail
     │   ├─ deliveredPrompt?   persisted verbatim at dispatch, so "what did it receive" is a field, not an inference
     │   ├─ result?      the report text + structured verdict for checks
     │   └─ loop?        { bodyNodeIDs, exitCheckNodeID, maxIterations, iteration }
     └─ Edge { fromNodeID, toNodeID, kind: "requires" | "feeds" }
```

`requires` edges gate dispatch; `feeds` edges additionally pipe the upstream
node's result into the downstream node's prompt (as a labeled context block).
That distinction is what lets synthesis nodes receive their inputs without the
planner hand-assembling context.

**Swarms and non-swarms are the same graph.** A swarm goal defaults each
node's executor to one of the team's roles (the planner assigns roles the way
the briefing teaches it today). A non-swarm goal attaches executors directly —
an agent name, or model + skill + instructions. A single-agent "keep fixing
until tests pass" is a goal whose graph is one loop node with a one-task body
and a check: loop engineering without ceremony.

## 4. Loop semantics

A `loop` node runs its body subgraph, then its exit check, then decides:

1. **Exit check passes** → loop is `done`; its result is the last iteration's
   synthesis.
2. **Check fails and `iteration < maxIterations`** → body re-runs. The check's
   failure report is fed into the next iteration's prompts (`feeds` edge from
   check to body), so each pass knows what was wrong — this is what makes it
   *refinement* rather than retry.
3. **Cap or budget trips** → loop is `failed` with the last check report as the
   reason, and an attention item fires. A loop never exits silently un-verified.

Convergence loops ("until dry") are the same shape with a check that compares
this iteration's findings against the accumulated set — the pattern the review
workflows already use, made a first-class node.

**Standing loops.** A goal with no `ownerSessionID` and a schedule (`source:
"schedule"` on its jobs — the enum already exists) re-instantiates its graph on
a cadence: nightly triage, recurring dependency bumps. Same graph, no chat
session, results land as attention items and a report artifact.

## 5. Planning: who builds the graph

The planner is a model with **graph tools**, not a hardcoded decomposer:

- `graph_plan(goal, nodes, edges)` — create/replace the plan while `planned`.
  Validation rejects cycles outside loop bodies, unknown executors, and
  check-less loops.
- `graph_update(nodeID, patch)` — re-plan mid-flight: add remediation nodes,
  skip obsolete ones. Append-only history; nothing is silently rewritten.
- `graph_report(nodeID, result)` — executors do not call this; the dispatcher
  records results. It exists for the planner to annotate.

In a swarm session, the planner is the orchestrator: the briefing gains a
"plan first" mode where, instead of free-form delegation, it must emit a graph
and then watch the dispatcher work (it still owns synthesis and the
conversation). In a non-swarm goal, the planner is whatever agent the user
launched — or the user themself via a future graph editor; the schema does not
care who authored the plan.

Free-form delegation (today's behavior) stays available. Graph mode is what
the orchestrator is *briefed* to use when the user creates a goal; it is not a
breaking change to existing swarms.

## 6. Dispatch: the runtime walks the graph

A reconcile loop (same pattern the legacy engine proved, rebuilt on jobs):

1. A node is **ready** when every `requires` edge points at a `done` node.
2. Ready nodes are enqueued as jobs (`kind: "graph-node"`, `parentJobID` =
   goal's root job). All ready nodes dispatch concurrently — parallelism is a
   property of the graph's shape, not a prompt suggestion.
3. The job handler resolves the executor, assembles the prompt
   (executor skill body → executor/role instructions → node brief → `feeds`
   context blocks), **persists `deliveredPrompt`**, runs the child session via
   the `runSwarmRole` path generalized to arbitrary executors, records
   `sessionID` and result.
4. `check` nodes must return a structured verdict (pass/fail + findings) via
   the structured-output path that already exists in the prompt loop.
5. Failures burn job attempts; a node failed past `maxAttempts` marks
   dependents `skipped`, fires attention, and hands control back to the
   planner for re-planning rather than wedging the goal.
6. `gate` nodes create an attention item and park as `awaiting_approval`; the
   existing permission/question UI is the approval surface.
7. Budget checks run at every dispatch; a tripped budget pauses the goal (no
   new dispatches, running nodes finish) rather than killing work mid-flight.

The dispatcher is deterministic and dumb on purpose. All intelligence lives in
the planner's graph and the executors' prompts — that is the "engineering" in
agent engineering: the topology is authored, inspectable, and repeatable.

## 7. UI

- **Session page — graph panel.** The team strip generalizes: for a goal
  session, a graph view (nodes colored by the existing status vocabulary,
  edges showing flow, loops drawn as grouped clusters with an iteration
  badge). Clicking a node opens what the team strip's member pane already
  does — the child transcript — plus a header showing the node brief and the
  persisted `deliveredPrompt` verbatim. The user's "view each subagent's work
  and the prompt it received" becomes a guaranteed field, not an inference
  from the first message.
- **The one-session rule holds.** Node sessions are children (`parentID`
  set), so every list keeps showing exactly one session per goal.
- **Project page.** Goals appear in the attention flow only when they need a
  human (gate, failure, budget pause) — running goals surface through the
  existing Running tile and status tinting, not a new list.
- **Goal composer.** Creating a goal = a prompt plus optional success
  criteria and budget, from the session composer ("run as goal") or the
  project page. For swarms, picking the swarm picks the default executor
  pool; for non-swarms, the user picks agent/model defaults.

## 8. Phasing

| Phase | Scope | Proves |
|-------|-------|--------|
| **1. Graph store + tools** | Goal/Node/Edge tables, validation, `graph_plan`/`graph_update`, orchestrator briefed to plan-first; nodes still executed by today's free-form delegate calls, manually. | The plan artifact: users can *see* the graph the orchestrator intends. |
| **2. Dispatcher** | Jobs-backed reconcile loop, `feeds` context piping, `deliveredPrompt` persistence, check verdicts, failure/attention wiring. | Auto-delegation: topology executes without the orchestrator driving each call. |
| **3. Loops** | Loop nodes, iteration feedback, convergence checks, budget caps. | Refinement until criteria hold — the goal actually closes itself. |
| **4. Graph UI** | Session-page graph panel + node inspector; goal composer. | The user watches the machine work and audits every prompt. |
| **5. Standing goals** | Scheduled/triggered goals with no owner session; report artifacts. | Recurring engineering without a chat window open. |
| **6. Cleanup** | Delete `swarm-run/execution/reconcile/plan-layer`, `Run`/`AgentRun` rows, `startSwarm`/`assignSwarmTask` endpoints. | One orchestration engine in the tree. |

Phases 1–2 are the same order of magnitude as the swarm-provider change was;
phase 4 is the largest GUI piece since the views manager. Each phase ships
alone and leaves today's behavior intact until phase 6.

## 9. What shipped, and where it departed from this plan

All six phases are implemented on `task/swarm-graphs`. Five deviations are
worth recording, because each one is a decision the plan got wrong:

- **`swarm-plan-layer.ts` is not a fossil.** §2 listed it among the dead
  legacy engine. It is live: it backs the `opencodex_swarm_create` tool. It
  stays; the rest of the legacy engine goes.
- **Goals ride the existing `operations` state domain**, alongside jobs and
  swarms, rather than getting their own. A new domain would have meant a
  thirteen-file change and five separate literal unions to keep in sync, for
  no behavioural gain — goals *are* operations.
- **The goal service is deliberately free of the prompt loop, and its layer
  leaves dependencies to the caller.** The graph tools live in the tool
  registry, which the prompt loop builds, so a service that depended on
  prompting would be an import cycle. Node execution is registered
  separately (`goal-runtime`). The second half matters as much: a
  self-provided layer inside the registry stands up a *second* project
  registry that resolves different config than the loop around it.
- **`graph_plan` blocks by default and returns every node's report.** The
  plan implied fire-and-forget. Blocking makes one tool call the whole
  interaction: state the shape of the work, get all the results back. Pass
  `wait: false` for standing goals. A `graph_status` tool was added; the
  planner-facing `graph_report` was not — the dispatcher records results, and
  annotation turned out to be a service concern, not a tool.
- **A failed body node retries its loop iteration** rather than failing the
  goal. The loop is already a bounded retry with feedback; making a body
  failure spend an iteration reuses that instead of adding a second mechanism.

Two rules are enforced rather than trusted, and both earned their tests: a
loop never exits unverified (a check that errors, is skipped, or returns no
verdict is a failure, not a pass), and a node's delivered prompt is persisted
at dispatch, so auditing an output against its input never depends on
reconstructing the prompt from a transcript.

A post-ship review found five defects, all fixed with tests:

- **A re-run collided with its own past.** Job idempotency keys were
  `goal:node:iteration`, so a standing goal's second sweep (and a re-queued
  failed node) adopted the previous run's *finished* job and hung "dispatched"
  forever. Keys now carry a run serial (`goal.metadata.runSerial`), bumped on
  every restart and re-queue; re-queueing also clears the node's old job,
  session, and result. The original standing-goal test stopped at
  "dispatched" on run two - which is exactly how the bug hid - so it now
  drives the second run to completion.
- **A failing check outside a loop changed nothing.** Its job succeeded, so
  the node read "done", dependents dispatched, and the goal completed - a
  verdict with no consequences. A done check whose verdict is a fail is now a
  failed node (loop exit checks excepted: failing those is how a loop decides
  to iterate), which skips its cone and fails the goal.
- **`graph_update` could not reach the goal that most needs repair.** It only
  looked for a non-terminal goal, but a *failed* goal is the re-planning case
  (§6.5); it now falls back to the most recent goal, and reopening by adding
  or re-queueing work is part of its contract.
- **Cancelling a standing goal skipped one run.** The schedule stayed armed
  and the sweep resurrected the "cancelled" goal on the next cadence. Cancel
  now pauses the schedule too.
- **Goals never reached the attention surfaces.** A parked gate or budget
  pause was visible only on the session page - and a standing goal has no
  session, so it was visible nowhere. Goals needing a human (blocked, paused,
  failed) now project into the shared work-item/attention pipeline (GUI queue,
  TUI, notifications) and the project overview badges. Approvals also gained a
  guard: only a node in `awaiting_approval` accepts one, and `graph_plan`'s
  blocking wait returns only once in-flight branches have landed, so its
  report is not a snapshot mid-stride.

A sixth defect surfaced only in CI: the nine goal HTTP endpoints shipped
with **no scenarios in the HTTP API exercise harness**, so its
`--fail-on-missing` gate listed every one as a miss. They are covered now.
The lesson worth keeping: the harness's `coverage` mode only maps route
presence, and `effect` mode is the one that actually executes assertions -
a green coverage run says nothing about whether an endpoint behaves.

Two pieces of §7 remain deliberately unshipped: the **goal composer** (goals
are created by `graph_plan` or the HTTP API today; `buildPlannerBrief` exists,
tested, for the composer to seed a planner session with) and a standing goal's
**report artifact** (its results live in the child sessions and node reports).

## 10. Risks and open questions

- **Planner quality.** A bad graph executes badly, deterministically. Counter:
  plans are visible before dispatch (phase 1 ships inspection before
  automation), `graph_update` allows mid-flight repair, and gates let cautious
  users approve the plan itself.
- **Context piping size.** `feeds` blocks can bloat prompts; node results need
  a summary form (the report text already is one) with the full transcript one
  click away, never inlined.
- **Executor drift for non-swarms.** A bare model+skill executor has no
  per-role identity for the team strip; the graph panel keys on nodes, not
  roles, which absorbs this.
- **Schema authority.** Goals/graphs are opencodex server state (SQL +
  HTTP + client-sync), not GUI localStorage — unlike role templates, a graph
  must survive the machine and be visible to every client. This is the main
  reason phase 1 is server-first.
- **Open:** should a completed goal's graph be re-runnable as a *runbook*
  (the job `source` enum already reserves the word)? Deferred to phase 5, but
  the schema keeps graphs copyable to allow it.
