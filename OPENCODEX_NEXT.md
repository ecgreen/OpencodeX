# OpencodeX Next

OpencodeX should become a full-blown Agentic Development Environment: a terminal-native control plane where a developer can launch, observe, coordinate, and govern many AI coding agents across many projects without leaving the TUI.

The current product already has the right spine:

- Upstream `opencode` compatibility for sessions, providers, MCP servers, plugins, SDK, skills, and storage.
- An OpencodeX project overlay with sidecar tables and namespaced routes under `/experimental/opencodex/*`.
- A persistent sidebar, project grouping, session management, and live derived status for dormant, running, and input-needed sessions.
- Native agents, subagents, background subagent jobs, custom agent config, and skill discovery.
- TUI plugins, command registration, raw SDK request support, and an additive route model.

The next generation should deepen those primitives instead of replacing them. The product should feel less like "multiple chats in a terminal" and more like a mission control room for software work: clear status, visible delegation, reviewable automation, trustworthy policy, and excellent keyboard ergonomics.

## Product Thesis

OpencodeX is the best terminal-native ADE for software agents.

It should let a developer:

- See every active, blocked, failed, queued, and completed agent run at a glance.
- Run many sessions side by side without losing important output or blocked prompts.
- Start a swarm from a complex prompt and watch specialized agents divide the work.
- Assign roles such as product manager, designer, architect, senior engineer, QA engineer, and code reviewer.
- Route different roles to different models or model profiles.
- Turn project learnings into reviewable memory, `AGENTS.md` updates, or project-local skills.
- Schedule, trigger, and resume work while keeping unattended actions governed by policy.
- Inspect what happened after the fact through timelines, logs, cost, token usage, and job diagnostics.
- Keep upstream compatibility and terminal speed intact.

## Design Principles

### Keep The TUI As The Control Plane

All new automation should come back to the TUI. Schedules, triggers, swarms, role agents, and background jobs should surface state through the dashboard, command palette, and session routes.

### Keep OpencodeX Additive

New durable state should prefer OpencodeX sidecar tables, namespaced APIs, and TUI routes. Touch upstream session/provider/plugin shapes only when the integration genuinely needs it.

### Prefer Inboxes Over Invisible Automation

Memory proposals, skill updates, external triggers, schedule runs, and risky swarm actions should be reviewable. OpencodeX can be powerful without silently changing future behavior.

### Make Agents Legible

A user should know who is working, what role they have, what model they are using, what they are waiting on, what they touched, and what they recommend next.

### Treat Swarms As Managed Jobs

A swarm is not just a long prompt with subagents. It is a durable job with a goal, roles, task graph, sessions, model choices, artifacts, status, approvals, and final synthesis.

### Build Role Skills As Product Assets

Role-specific `SKILL.md` files should be first-class assets that teach agents how to act as product managers, designers, architects, senior engineers, QA engineers, code reviewers, release managers, and domain specialists. These should be inspectable, versioned, and project-overridable.

## Current Integration Points

The following existing surfaces are the most important anchors for next-gen work:

- `packages/core/src/opencodex/sql.ts`: current OpencodeX sidecar tables.
- `packages/opencode/src/opencodex/project.ts`: OpencodeX project/session service.
- `packages/opencode/src/server/routes/instance/httpapi/groups/opencodex.ts`: namespaced route group.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/opencodex.ts`: current OpencodeX handlers.
- `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar.tsx`: sidebar/project/session UI.
- `packages/opencode/src/cli/cmd/tui/app.tsx`: command registration and route integration.
- `packages/opencode/src/agent/agent.ts`: native/custom agent definitions and permissions.
- `packages/opencode/src/tool/task.ts`: subagent task execution and background mode.
- `packages/opencode/src/background/job.ts`: in-process background job registry.
- `packages/opencode/src/skill`: skill discovery and prompt assets.
- `packages/opencode/specs/tui-plugins.md`: TUI plugin route/command extension model.
- `docs/opencodex-upstream.md`: upstream touchpoints and merge-sensitive seams.

## Roadmap Phases

### Phase 1: Operational Cockpit

Goal: make current multi-session work feel like managing real jobs.

- Rich fullscreen dashboard.
- Better session/job row metadata.
- Multi-session output view.
- Tags, filters, quick actions, and blocked reasons.
- Durable job registry sidecar.
- Role skill pack scaffolding.

### Phase 2: Swarm MVP

Goal: let a user submit one complex prompt and supervise delegated role agents.

- Swarm create/list/get/cancel APIs.
- Swarm planning flow.
- Role-based sub-sessions.
- Synthesis session.
- Swarm dashboard route.
- Manual approval gates.

### Phase 3: Governed Automation

Goal: make swarms, schedules, triggers, and project memory safe enough for daily use.

- Project memory proposal inbox.
- Skill update proposal inbox.
- Model profiles and fallback chains.
- Policy actions for scheduled, triggered, and swarm work.
- One-shot schedules and trigger inbox.
- Observability timeline.

### Phase 4: Durable ADE Platform

Goal: make OpencodeX a dependable long-running local control plane.

- Headless/attach workflows.
- Persistent job recovery.
- Recurring schedules.
- Connector framework.
- Worktree/container workspace adapters.
- Advanced runbooks and parallel fanout/fanin.
- Shareable role packs, runbooks, and project memory.

## Ticket Index

| ID | Title | Phase | Priority |
| --- | --- | --- | --- |
| OXNEXT-001 | Define ADE information architecture | 1 | P0 |
| OXNEXT-002 | Add durable OpencodeX job model | 1 | P0 |
| OXNEXT-003 | Build fullscreen operations dashboard | 1 | P0 |
| OXNEXT-004 | Add richer session status derivation | 1 | P0 |
| OXNEXT-005 | Add multi-session output view | 1 | P0 |
| OXNEXT-006 | Add session tags, filters, and quick actions | 1 | P1 |
| OXNEXT-007 | Create built-in role skill pack | 1 | P0 |
| OXNEXT-008 | Add role agent config templates | 1 | P1 |
| OXNEXT-009 | Define swarm data model | 2 | P0 |
| OXNEXT-010 | Add swarm API routes | 2 | P0 |
| OXNEXT-011 | Implement swarm planner | 2 | P0 |
| OXNEXT-012 | Implement swarm execution engine | 2 | P0 |
| OXNEXT-013 | Add swarm TUI route | 2 | P0 |
| OXNEXT-014 | Add swarm synthesis and handoff summaries | 2 | P0 |
| OXNEXT-015 | Add swarm approvals and stop controls | 2 | P1 |
| OXNEXT-016 | Add project memory proposal ledger | 3 | P1 |
| OXNEXT-017 | Add skill lifecycle manager | 3 | P1 |
| OXNEXT-018 | Add model profiles and role routing | 3 | P1 |
| OXNEXT-019 | Expand policy for ADE automation | 3 | P0 |
| OXNEXT-020 | Add schedules and trigger inbox foundations | 3 | P1 |
| OXNEXT-021 | Add session and swarm timeline observability | 3 | P1 |
| OXNEXT-022 | Add runbooks for repeatable workflows | 4 | P2 |
| OXNEXT-023 | Harden headless service and attach mode | 4 | P2 |
| OXNEXT-024 | Add workspace adapters for parallel agents | 4 | P2 |

## Tickets

### OXNEXT-001: Define ADE Information Architecture

Priority: P0

Phase: 1

Type: product, design, engineering

Problem:

OpencodeX currently has a dashboard and sidebar, but next-gen features need a shared information model. Without this, sessions, background jobs, swarms, schedules, triggers, memory, and role skills will become separate screens with inconsistent status language.

User story:

As a developer running many agents, I want one consistent mental model for all work so I can tell what is running, blocked, waiting for approval, failed, complete, or stale.

Specification:

- Define top-level ADE entities: project, session, job, swarm, role, skill, schedule, trigger, memory proposal, runbook, workspace.
- Define status vocabulary shared across routes:
  - queued
  - running
  - input_needed
  - approval_needed
  - blocked
  - failed
  - completed
  - cancelled
  - stale
- Define source vocabulary:
  - manual
  - swarm
  - subagent
  - schedule
  - trigger
  - runbook
  - plugin
- Define TUI navigation structure:
  - Dashboard
  - Sessions
  - Multi-View
  - Swarms
  - Agents
  - Skills
  - Memory
  - Schedules
  - Triggers
  - Settings/Policy
- Define common row shape used by dashboard-like views:
  - id
  - kind
  - title
  - project
  - status
  - status reason
  - source
  - model/provider
  - agent/role
  - started time
  - last activity time
  - token/cost summary when available
  - quick actions

Engineering notes:

- Start as a spec and type sketch before implementation.
- Keep naming aligned with existing session status and permission/question data.
- Avoid schema changes in upstream session tables.

Acceptance criteria:

- A small internal spec exists in `OPENCODEX_NEXT.md` or a package spec file.
- The status vocabulary is reusable by dashboard, sidebar, job, and swarm tickets.
- The design calls out which fields are derived and which are persisted.

### OXNEXT-002: Add Durable OpencodeX Job Model

Priority: P0

Phase: 1

Type: backend, storage, API

Problem:

`BackgroundJob.Service` is currently in-process. It is useful for background subagents but does not give OpencodeX a durable operations model across restarts or across different job sources.

User story:

As a developer, I want agent work to remain visible after a restart so I can inspect what happened and recover from interruptions.

Specification:

- Add OpencodeX-owned sidecar table `opencodex_job`.
- Suggested fields:
  - `id`
  - `kind`
  - `title`
  - `status`
  - `source`
  - `project_id`
  - `session_id`
  - `parent_job_id`
  - `swarm_id`
  - `role_id`
  - `agent`
  - `provider_id`
  - `model_id`
  - `started_at`
  - `updated_at`
  - `completed_at`
  - `status_reason`
  - `metadata_json`
- Add indexes for project, session, swarm, status, and updated time.
- Create service methods:
  - `list`
  - `get`
  - `create`
  - `updateStatus`
  - `attachSession`
  - `complete`
  - `cancel`
- Bridge in-process background jobs into durable job rows.
- Preserve existing `BackgroundJob` behavior while adding persistence.

Engineering notes:

- Put tables in `packages/core/src/opencodex/sql.ts`.
- Add migration under `packages/core/src/database/migration`.
- Put server-facing service in `packages/opencode/src/opencodex/job.ts`.
- Keep `metadata_json` schema decoded with Effect schema helpers, not ad hoc `JSON.parse`.

Acceptance criteria:

- Creating a background subagent can create/update an OpencodeX job row.
- Job rows survive TUI restart.
- Dashboard can list jobs without relying only on in-memory state.
- Existing background subagent tests still describe current behavior.

### OXNEXT-003: Build Fullscreen Operations Dashboard

Priority: P0

Phase: 1

Type: TUI, product

Problem:

The current dashboard is useful for session resumption, but an ADE needs a high-level view that can manage sessions, jobs, swarms, schedules, triggers, and blocked work.

User story:

As a developer, I want a fullscreen dashboard that shows all active and recent agent work so I can manage the whole workspace from one place.

Specification:

- Add a fullscreen dashboard route with sections:
  - Attention needed
  - Running now
  - Queued
  - Swarms
  - Recently completed
  - Recent sessions
  - Upcoming schedules
  - Trigger inbox
- Each row uses the ADE row shape from OXNEXT-001.
- Support keyboard actions:
  - Enter: open focused item
  - `n`: new session
  - `s`: new swarm
  - `f`: filter
  - `t`: tag
  - `p`: pin
  - `x`: stop/cancel
  - `r`: resume/retry
  - `/`: search
  - `?`: command palette/help
- Keep the existing sidebar available while on the dashboard.
- Show clear empty states without turning the dashboard into a marketing page.

Engineering notes:

- Register route through the same TUI route/command seams used by current OpencodeX commands.
- Reuse existing theme, dialog, command palette, and sync context.
- Avoid nested cards. Use compact bands, tables, and focused details.

Acceptance criteria:

- Launching `opencodex` lands on the operations dashboard.
- Running and blocked sessions are visible without opening project groups.
- Users can jump from a dashboard row into the backing session or swarm.
- The view remains usable in narrow terminals.

### OXNEXT-004: Add Richer Session Status Derivation

Priority: P0

Phase: 1

Type: TUI, backend

Problem:

Current derived status is intentionally simple: dormant, in progress, input needed. Next-gen operations need richer reasons and metadata.

User story:

As a developer, I want to know why a session needs attention so I can respond quickly.

Specification:

- Extend derived status logic to compute:
  - status
  - reason
  - reason details
  - last tool
  - last file touched when available
  - last user prompt preview
  - last assistant output preview
  - runtime duration
  - idle duration
  - model/provider
  - permission/question count
- Reason examples:
  - permission requested
  - question asked
  - model retrying
  - model timeout
  - tool failed
  - shell failed
  - context compacting
  - background job running
  - completed with errors
- Use the richer derivation in sidebar, dashboard, and multi-session view.

Engineering notes:

- Start with derived TUI logic over existing sync data.
- Promote to a shared service only when multiple routes need the same behavior.
- Keep existing color mapping compatible:
  - running: blue
  - attention: orange
  - failed: red
  - completed: green or muted
  - idle: gray

Acceptance criteria:

- A permission prompt row says it needs permission, not only "input needed".
- A question row says it has a question.
- Running rows show elapsed time and last known action.
- Sidebar and dashboard use the same status logic.

### OXNEXT-005: Add Multi-Session Output View

Priority: P0

Phase: 1

Type: TUI

Problem:

Users want to watch output from multiple sessions at once. The current model requires switching into one session at a time.

User story:

As a developer running multiple agents, I want a split-pane view showing several sessions at once so I can monitor progress without context switching.

Specification:

- Add "Multi-View" route.
- Allow selecting 2-6 sessions to watch.
- Provide layouts:
  - two-column
  - stacked
  - grid
  - focus plus side rail
- Each pane shows:
  - session title
  - project
  - agent/model
  - status color/reason
  - latest assistant/user/tool output
  - permission/question indicator
- Keyboard actions:
  - Enter: focus pane/open session
  - Tab/Shift+Tab: move pane focus
  - `a`: add session
  - `d`: remove session from view
  - `l`: change layout
  - `x`: stop focused session
  - `r`: resume/retry focused session
- Persist named layouts in local TUI KV.
- Include a "follow latest output" toggle per pane.

Engineering notes:

- Use existing sync data instead of tailing files directly.
- Keep panes stable in width/height to avoid layout jitter as text changes.
- Defer full scrollback in MVP; latest-output panes are enough for first value.

Acceptance criteria:

- User can select multiple sessions and see live updates from each.
- A blocked pane is visually obvious.
- Enter opens the selected session.
- Layout is usable at common terminal sizes.

### OXNEXT-006: Add Session Tags, Filters, And Quick Actions

Priority: P1

Phase: 1

Type: TUI, storage, API

Problem:

As the session count grows, project grouping and recency are not enough.

User story:

As a developer, I want to label and filter sessions so I can manage many concurrent workstreams.

Specification:

- Add sidecar metadata for session tags and pins beyond existing session data.
- Add filters:
  - project
  - status
  - tag
  - agent
  - model
  - source
  - updated time
- Add quick actions:
  - rename
  - pin/unpin
  - tag/untag
  - move project
  - compact
  - stop
  - retry last prompt
  - copy session ID
  - open containing folder
- Surface quick actions in dashboard, sidebar, and session list.

Engineering notes:

- Store tags in OpencodeX sidecar tables.
- Do not modify upstream session schema.
- Keep action names registered in the command palette.

Acceptance criteria:

- User can add a tag to a session and filter by it.
- Tags survive restart.
- Quick actions are keyboard accessible.

### OXNEXT-007: Create Built-In Role Skill Pack

Priority: P0

Phase: 1

Type: skills, product, prompt engineering

Problem:

Swarm quality depends on role clarity. Generic subagents will not reliably behave like product managers, designers, architects, QA engineers, or reviewers without strong role instructions.

User story:

As a developer, I want built-in role skills so swarms can delegate work to specialized agents with useful defaults.

Specification:

- Add built-in role skill files:
  - product-manager/SKILL.md
  - designer/SKILL.md
  - architect/SKILL.md
  - senior-engineer/SKILL.md
  - qa-engineer/SKILL.md
  - code-reviewer/SKILL.md
  - release-engineer/SKILL.md
  - docs-engineer/SKILL.md
  - security-reviewer/SKILL.md
- Each role skill should include:
  - role mission
  - when to use
  - expected inputs
  - expected outputs
  - collaboration contract
  - boundaries and anti-goals
  - handoff format
  - quality checklist
- Role skills should be usable by normal agents and swarm agents.
- Project-local role skill overrides should take precedence through existing skill discovery rules.

Engineering notes:

- Prefer skills over hard-coded prompts where possible.
- Keep skills concise but operational.
- Do not encode provider-specific behavior in role skills.

Acceptance criteria:

- Role skills are discoverable by the skill picker.
- A swarm role can reference the corresponding skill.
- Each skill has a consistent handoff output format.

### OXNEXT-008: Add Role Agent Config Templates

Priority: P1

Phase: 1

Type: config, agents

Problem:

Skills describe behavior, but the agent runtime also needs role-specific permissions, default tools, and model preferences.

User story:

As a developer, I want ready-made role agents so I can launch a useful swarm without hand-writing config.

Specification:

- Add optional built-in agent templates:
  - `pm`
  - `designer`
  - `architect`
  - `engineer`
  - `qa`
  - `reviewer`
  - `release`
  - `docs`
  - `security`
- Suggested default modes:
  - primary or all for `engineer`
  - subagent for specialized roles
- Suggested permission posture:
  - PM: read/search/write planning artifacts only
  - Architect: read/search, no edits by default
  - Engineer: normal edit permissions under project roots
  - QA: read/search/shell ask or allow per project rules
  - Reviewer: read/search, no edits by default
  - Security: read/search, sensitive file reads ask
- Allow users to override model/profile per role.

Engineering notes:

- Current `Agent.Service` builds native agents then merges config agents.
- Keep templates additive and allow disable/override.
- Consider gating behind `experimental.role_agents` until stable.

Acceptance criteria:

- Role agents appear in agent picker when enabled.
- Role agents can be selected for subagent tasks.
- User config can override or disable them.

### OXNEXT-009: Define Swarm Data Model

Priority: P0

Phase: 2

Type: backend, storage, product

Problem:

Swarm work needs durable state separate from sessions. A swarm has a goal, plan, roles, child sessions, approvals, and synthesis.

User story:

As a developer, I want a swarm to be a named, inspectable job so I can supervise complex delegated work.

Specification:

- Add sidecar table `opencodex_swarm`.
- Suggested fields:
  - `id`
  - `project_id`
  - `title`
  - `prompt`
  - `status`
  - `created_at`
  - `updated_at`
  - `started_at`
  - `completed_at`
  - `created_by`
  - `synthesis_session_id`
  - `metadata_json`
- Add table `opencodex_swarm_role`.
- Suggested fields:
  - `id`
  - `swarm_id`
  - `name`
  - `agent`
  - `skill`
  - `provider_id`
  - `model_id`
  - `model_profile`
  - `status`
  - `instructions`
  - `sort_order`
  - `session_id`
  - `job_id`
  - `metadata_json`
- Add table `opencodex_swarm_event`.
- Suggested fields:
  - `id`
  - `swarm_id`
  - `role_id`
  - `session_id`
  - `kind`
  - `message`
  - `metadata_json`
  - `created_at`

Engineering notes:

- Use snake_case fields to match Drizzle style.
- Keep role sessions as normal upstream sessions with OpencodeX metadata.
- Do not introduce a new transcript format.

Acceptance criteria:

- A swarm can be persisted with roles and linked sessions.
- Swarm state survives restart.
- Swarm list can be queried by project and status.

### OXNEXT-010: Add Swarm API Routes

Priority: P0

Phase: 2

Type: API, backend

Problem:

The TUI and future SDK clients need a stable API for swarms.

User story:

As a TUI user or SDK client, I want to create, inspect, start, and cancel swarms through OpencodeX routes.

Specification:

- Add routes under `/experimental/opencodex/swarm`.
- Endpoints:
  - `GET /swarm`: list swarms
  - `POST /swarm`: create swarm
  - `GET /swarm/:swarmID`: get swarm details
  - `POST /swarm/:swarmID/start`: start planned swarm
  - `POST /swarm/:swarmID/cancel`: cancel swarm
  - `POST /swarm/:swarmID/role`: add role
  - `PATCH /swarm/:swarmID/role/:roleID`: update role
  - `DELETE /swarm/:swarmID/role/:roleID`: remove role before start
  - `GET /swarm/:swarmID/event`: list events
- Payloads should support:
  - project ID
  - prompt
  - title
  - desired roles
  - model/profile hints
  - approval mode
  - workspace mode hint

Engineering notes:

- Mirror current OpencodeX route organization.
- Add schemas in the route group file.
- Put service logic in `packages/opencode/src/opencodex/swarm.ts`.

Acceptance criteria:

- TUI can create/list/get/cancel swarms via raw SDK request.
- Route errors map to existing bad request/not found patterns.
- API remains namespaced and additive.

### OXNEXT-011: Implement Swarm Planner

Priority: P0

Phase: 2

Type: agent orchestration

Problem:

A complex prompt needs to be decomposed into role-specific work before execution.

User story:

As a developer, I want OpencodeX to propose a sensible swarm plan from my prompt so I can approve or edit it before agents run.

Specification:

- Add planner flow that creates:
  - swarm title
  - task summary
  - role list
  - per-role objective
  - per-role expected output
  - dependencies between roles
  - suggested model/profile per role
  - approval gates
  - final synthesis criteria
- Planner should default to common role patterns:
  - PM clarifies product requirements and acceptance criteria.
  - Architect identifies design constraints and integration plan.
  - Engineer implements or proposes implementation.
  - QA validates behavior and edge cases.
  - Reviewer inspects code and risks.
- Planner should not start execution until the user approves in MVP.
- Planner output should be stored in swarm role rows.

Engineering notes:

- Use a small/deep model based on config once model profiles exist; before that use current default model.
- Keep planner as a normal session or internal model call depending on implementation cost.
- Avoid overfitting to one fixed role list; let users add/remove roles.

Acceptance criteria:

- User can submit a complex prompt and receive an editable role plan.
- No role session starts before approval.
- Approved plan creates role rows with instructions.

### OXNEXT-012: Implement Swarm Execution Engine

Priority: P0

Phase: 2

Type: backend, orchestration

Problem:

Swarm roles must be executed as managed child sessions with clear status and cancellation.

User story:

As a developer, I want each role in a swarm to run as its own visible agent session so I can inspect and intervene.

Specification:

- Start role sessions as normal sessions linked to the swarm.
- Each role session should include:
  - original prompt
  - swarm context
  - role skill
  - role-specific objective
  - expected output contract
  - dependencies/handoff context
- Support execution modes:
  - sequential
  - parallel independent roles
  - dependency-gated roles
- MVP can start with:
  - planner approval
  - parallel research/review roles
  - engineer role
  - synthesis role
- Update role and swarm statuses as sessions run.
- Create durable job rows for role execution.
- Cancel should stop running role sessions where possible and mark pending roles cancelled.

Engineering notes:

- Build on existing session creation and task/background job primitives.
- Keep child sessions inspectable in normal session views.
- Avoid hidden transcripts.

Acceptance criteria:

- Starting a swarm launches role sessions.
- Each role session appears in dashboard/sidebar with swarm metadata.
- Cancelling a swarm attempts to cancel active role work.
- Completed role output is available to synthesis.

### OXNEXT-013: Add Swarm TUI Route

Priority: P0

Phase: 2

Type: TUI

Problem:

Users need a place to create, approve, watch, and inspect swarms.

User story:

As a developer, I want a swarm view that shows the original goal, role plan, live role statuses, and final synthesis.

Specification:

- Add Swarms route with:
  - swarm list
  - create swarm prompt
  - plan review
  - role table
  - event timeline
  - final synthesis panel
- Role table columns:
  - role
  - agent
  - model/profile
  - status
  - last activity
  - session link
  - output preview
- Actions:
  - approve plan
  - edit role
  - add role
  - remove role before start
  - start
  - cancel
  - open role session
  - open multi-view for swarm
  - synthesize now
- The route should support narrow terminals with stacked sections.

Engineering notes:

- Use existing dialogs and command palette patterns.
- Keep text dense and operational.
- Avoid explanatory marketing copy in the app.

Acceptance criteria:

- User can create a swarm from the TUI.
- User can approve/start/cancel from the route.
- User can jump to role sessions.
- Status updates without manual restart.

### OXNEXT-014: Add Swarm Synthesis And Handoff Summaries

Priority: P0

Phase: 2

Type: agent orchestration, product

Problem:

Parallel role output is only useful if the user receives a coherent final answer and can inspect disagreements.

User story:

As a developer, I want a swarm to produce a final synthesis that combines role outputs, highlights risks, and names the next action.

Specification:

- Add synthesis step that consumes role outputs.
- Synthesis output should include:
  - decision summary
  - work completed
  - files changed or proposed
  - acceptance criteria status
  - disagreements between roles
  - risks and open questions
  - recommended next action
- Store synthesis as a normal session linked by `synthesis_session_id`.
- Allow "synthesize now" even if some roles are still running.
- If roles disagree, do not hide the disagreement.

Engineering notes:

- Use a dedicated synthesis role skill or agent.
- Keep role handoff formats consistent via OXNEXT-007.
- Synthesis should reference role session IDs for provenance.

Acceptance criteria:

- Completed swarm has a final synthesis.
- User can open the synthesis session.
- Synthesis names incomplete or failed roles.

### OXNEXT-015: Add Swarm Approvals And Stop Controls

Priority: P1

Phase: 2

Type: policy, TUI, backend

Problem:

Swarm delegation can amplify mistakes. Users need control before and during execution.

User story:

As a developer, I want to approve risky swarm actions and stop runaway work quickly.

Specification:

- Add approval modes:
  - manual approval before start
  - approval before edit-capable roles
  - approval before shell-capable roles
  - approval before synthesis finalization
- Add stop controls:
  - stop role
  - stop swarm
  - pause new role starts
  - cancel pending roles
- Show approval requests in dashboard attention section.
- Track approval decisions in swarm events.

Engineering notes:

- Integrate with existing permission/question surfaces where practical.
- Expand policy vocabulary in OXNEXT-019.

Acceptance criteria:

- Swarm can be configured to require approval before edit roles run.
- Stop swarm action updates role statuses.
- Dashboard clearly shows swarm approval requests.

### OXNEXT-016: Add Project Memory Proposal Ledger

Priority: P1

Phase: 3

Type: storage, TUI, agent behavior

Problem:

Multi-session work should compound, but agents should not silently rewrite instructions.

User story:

As a developer, I want agents to propose project learnings that I can accept, reject, edit, or promote to `AGENTS.md` or a skill.

Specification:

- Add sidecar table `opencodex_memory`.
- Fields:
  - id
  - project_id
  - kind
  - text
  - status
  - confidence
  - source_session_id
  - source_job_id
  - source_swarm_id
  - created_at
  - updated_at
  - expires_at
  - metadata_json
- Add statuses:
  - proposed
  - accepted
  - rejected
  - archived
  - promoted
- Add Memory route/inbox.
- Let agents propose learnings at end of sessions or swarms.
- Accepted memories are injected into future session context with provenance.

Engineering notes:

- Start with manual proposal creation from TUI or command.
- Later add internal `memory.propose` tool/hook.
- Use explicit user approval before editing `AGENTS.md` or skills.

Acceptance criteria:

- User can accept/reject/edit a memory proposal.
- Accepted memory appears in future context.
- Provenance is visible.

### OXNEXT-017: Add Skill Lifecycle Manager

Priority: P1

Phase: 3

Type: TUI, skills

Problem:

Skills exist, but users need to inspect, create, update, test, and retire them.

User story:

As a developer, I want a skill manager so project procedures can evolve without becoming invisible prompt clutter.

Specification:

- Add Skills route.
- Show:
  - name
  - description
  - path/source
  - enabled/disabled
  - last used
  - project/global scope
  - role association when applicable
- Actions:
  - create project skill
  - open/copy path
  - enable/disable
  - propose update
  - accept/reject proposed update
  - run sample prompt test
- Add skill update proposal object tied to memory and role systems.

Engineering notes:

- Reuse existing skill discovery.
- Do not build a marketplace in this ticket.
- Keep skill edits reviewable.

Acceptance criteria:

- User can see discovered skills from the TUI.
- User can create a project-local skill.
- Proposed skill updates are not applied without approval.

### OXNEXT-018: Add Model Profiles And Role Routing

Priority: P1

Phase: 3

Type: config, provider UX, swarms

Problem:

Swarm roles may need different models. Users should not manually memorize every provider's model matrix.

User story:

As a developer, I want roles to use model profiles such as fast, deep, cheap, review, and local so swarms are easier to configure.

Specification:

- Add model profile config:
  - profile name
  - provider/model list
  - fallback chain
  - capability tags
  - max cost hint
  - preferred roles
- Built-in suggested profiles:
  - fast
  - deep
  - cheap
  - review
  - planning
  - synthesis
  - local
- Let swarm roles choose:
  - exact model
  - profile
  - inherit swarm default
  - inherit project default
- Show resolved provider/model in TUI.
- Track provider/model failures for future fallback.

Engineering notes:

- Keep exact model selection visible.
- Start with config and TUI picker; automatic routing can come later.

Acceptance criteria:

- A role can specify `model_profile: review`.
- TUI shows the resolved model.
- If first fallback fails, engine can attempt next configured model where safe.

### OXNEXT-019: Expand Policy For ADE Automation

Priority: P0

Phase: 3

Type: policy, safety, backend

Problem:

Manual prompts, swarms, schedules, and external triggers have different risk profiles.

User story:

As a developer, I want unattended and delegated work to respect explicit policy so automation remains trustworthy.

Specification:

- Add policy actions:
  - `swarm.create`
  - `swarm.start`
  - `swarm.role.start`
  - `swarm.cancel`
  - `schedule.create`
  - `schedule.run`
  - `trigger.receive`
  - `trigger.run`
  - `memory.accept`
  - `skill.update`
  - `model.profile.use`
  - `workspace.create`
- Add policy context:
  - source
  - project
  - role
  - agent
  - model/profile
  - trigger sender
  - schedule id
  - workspace mode
- Default external triggers and scheduled runs to approval-required.
- Show policy denial/approval reasons in the TUI.

Engineering notes:

- Align with current permission ruleset vocabulary.
- Policy is a harness-level control, not a full sandbox.

Acceptance criteria:

- Swarm start can be denied or require approval by policy.
- Scheduled run cannot silently start if policy requires manual approval.
- Dashboard shows policy-blocked work clearly.

### OXNEXT-020: Add Schedules And Trigger Inbox Foundations

Priority: P1

Phase: 3

Type: automation, API, TUI

Problem:

OpencodeX should support durable wakeups and external events, but those should enter through governed queues.

User story:

As a developer, I want scheduled and externally triggered work to appear in the TUI before it starts risky agent actions.

Specification:

- Add schedule sidecar table.
- Support one-shot schedules first.
- Schedule fields:
  - id
  - project_id
  - target session/swarm/runbook
  - prompt
  - run_at
  - status
  - approval mode
  - metadata_json
- Add trigger inbox sidecar table.
- Trigger fields:
  - id
  - source
  - project_id
  - sender
  - summary
  - raw metadata
  - suggested action
  - status
- Add TUI routes:
  - Schedules
  - Trigger Inbox
- Add local route to create triggers.

Engineering notes:

- Run schedules only while TUI or `serve` is active for MVP.
- Do not build Slack/Discord connectors until inbox exists.

Acceptance criteria:

- User can create a one-shot scheduled prompt.
- Upcoming schedule appears in dashboard.
- Trigger can be created through local API and approved from TUI.

### OXNEXT-021: Add Session And Swarm Timeline Observability

Priority: P1

Phase: 3

Type: observability, TUI

Problem:

As agents multiply, users need to know what happened and why.

User story:

As a developer, I want a timeline for sessions and swarms so I can debug failures, review decisions, and trust the system.

Specification:

- Add timeline view for:
  - session
  - job
  - swarm
  - role
- Timeline event kinds:
  - prompt submitted
  - model call started/completed/failed
  - tool call started/completed/failed
  - permission requested/replied
  - question asked/replied
  - status changed
  - role started/completed
  - synthesis started/completed
  - policy decision
  - cancellation
- Include:
  - timestamps
  - duration
  - model/provider
  - error summaries
  - linked files where available
  - linked session/job IDs

Engineering notes:

- Reuse existing event streams where possible.
- Persist OpencodeX-specific events in `opencodex_swarm_event` and future job events.
- Do not attempt deterministic replay in MVP.

Acceptance criteria:

- User can inspect why a swarm role failed.
- Timeline includes permission and policy events.
- Timeline links back to sessions.

### OXNEXT-022: Add Runbooks For Repeatable Workflows

Priority: P2

Phase: 4

Type: automation, product

Problem:

Users will want reusable workflows such as "review PR", "fix CI", "prepare release", and "migrate dependency".

User story:

As a developer, I want to run a repeatable workflow that can create sessions, start swarms, wait for approvals, and synthesize results.

Specification:

- Add project/global runbook discovery.
- Format: JSONC or YAML.
- Runbook steps:
  - prompt session
  - start role
  - start swarm
  - wait for completion
  - request approval
  - run schedule
  - create memory proposal
  - synthesize
- Support inputs and variables.
- Show progress in dashboard.

Engineering notes:

- Runbooks should compose existing primitives.
- Avoid complex conditionals in MVP.

Acceptance criteria:

- User can run a "review PR" runbook from command palette.
- Runbook progress appears as a job.
- Approval gates pause execution.

### OXNEXT-023: Harden Headless Service And Attach Mode

Priority: P2

Phase: 4

Type: backend, CLI, docs

Problem:

Swarms, schedules, and triggers become more useful when OpencodeX can run headless and let TUIs attach.

User story:

As a developer, I want to leave OpencodeX running in a terminal, tmux, WSL, SSH, or server process and attach later.

Specification:

- Improve `serve` UX:
  - show server URL
  - show auth state
  - show active clients
  - show active jobs
- Add `opencodex attach` ergonomics.
- Persist local server metadata for discoverability.
- Document tmux/systemd/WSL-friendly workflows.
- Add graceful shutdown behavior for running jobs.

Engineering notes:

- Do not require a daemon for normal use.
- Keep remote access secure and explicit.

Acceptance criteria:

- User can start a headless server and attach a TUI.
- Dashboard shows jobs created before attach.
- Docs describe the workflow.

### OXNEXT-024: Add Workspace Adapters For Parallel Agents

Priority: P2

Phase: 4

Type: workspace, safety, orchestration

Problem:

Parallel agents can conflict when editing the same working tree.

User story:

As a developer, I want swarms to optionally isolate role work in worktrees or containers so parallel agents do not trample each other.

Specification:

- Add workspace modes:
  - current working directory
  - git worktree
  - temporary clone
  - container
  - read-only reference
- MVP should support worktree mode first.
- Swarm role can request workspace mode.
- Dashboard shows workspace label/path.
- Synthesis reports how changes should be merged.

Engineering notes:

- Reuse `packages/containers` where relevant later.
- Worktree mode should be explicit and reversible.
- Avoid hidden destructive cleanup.

Acceptance criteria:

- User can start a role in a separate worktree.
- Workspace path is visible in TUI.
- Cancelling a role does not delete work without user confirmation.

## Suggested MVP Build Order

1. OXNEXT-001: Define ADE information architecture.
2. OXNEXT-002: Add durable OpencodeX job model.
3. OXNEXT-004: Add richer session status derivation.
4. OXNEXT-003: Build fullscreen operations dashboard.
5. OXNEXT-005: Add multi-session output view.
6. OXNEXT-007: Create built-in role skill pack.
7. OXNEXT-009: Define swarm data model.
8. OXNEXT-010: Add swarm API routes.
9. OXNEXT-011: Implement swarm planner.
10. OXNEXT-012: Implement swarm execution engine.
11. OXNEXT-013: Add swarm TUI route.
12. OXNEXT-014: Add swarm synthesis and handoff summaries.
13. OXNEXT-019: Expand policy for ADE automation.

This order creates the operational base first, then adds swarm behavior on top of visible durable jobs. It avoids shipping powerful delegation before users can see and stop what is happening.

## Swarm MVP Example

User prompt:

```text
Design and implement the next-generation OpencodeX dashboard with multi-session monitoring and swarm management.
```

Planner creates:

- Product manager: define user workflows, acceptance criteria, and dashboard information priorities.
- Architect: map data model, route structure, TUI state, and upstream touchpoints.
- Senior engineer: implement dashboard route and data adapters.
- QA engineer: identify edge cases, terminal sizes, keyboard flows, and regression tests.
- Code reviewer: inspect implementation for regressions, overreach, and missing policy concerns.
- Synthesizer: combine role outputs into final summary and next actions.

Execution:

- PM and architect run in parallel as read-only roles.
- Engineer waits for architect handoff.
- QA and reviewer inspect after implementation.
- Synthesizer runs after all completed roles or when the user requests synthesis.
- Dashboard shows each role as a row with status, model, session link, and output preview.
- Multi-session view can open all role sessions in a grid.

## Role Skill Output Contract

Every role skill should end with a compact handoff:

```text
## Handoff

Decision:
Work completed:
Key evidence:
Risks:
Open questions:
Recommended next action:
Artifacts:
```

For code-changing roles, add:

```text
Files changed:
Behavior changed:
Validation performed:
Validation not performed:
```

For review roles, add:

```text
Findings:
Severity:
Suggested fix:
Residual risk:
```

This makes swarm synthesis dramatically easier and keeps role output legible to humans.

## Non-Goals For The First Swarm Release

- No always-on daemon requirement.
- No cloud dashboard.
- No autonomous project manager that silently creates work.
- No Slack/Discord/email connectors before trigger inbox.
- No silent edits to `AGENTS.md` or role skills.
- No hidden swarm transcripts.
- No mandatory containers.
- No custom transcript format that breaks upstream session compatibility.

## Definition Of Remarkable

OpencodeX Next is remarkable when a developer can open one terminal and confidently manage an entire day of agentic software work:

- A dashboard shows exactly what is running, blocked, queued, done, and risky.
- A multi-session view makes several agents observable at once.
- A swarm can decompose a complex goal into real role agents.
- Role agents produce useful handoffs instead of vague chat.
- Different models can be used intentionally by role.
- Project memory and skills improve future work through reviewable proposals.
- Schedules and triggers create work through governed inboxes.
- Policy, timelines, and cancellation make automation feel controllable.
- The terminal stays fast, keyboard-first, and compatible with upstream `opencode`.

That is the path from a better multi-session TUI to a true ADE.
