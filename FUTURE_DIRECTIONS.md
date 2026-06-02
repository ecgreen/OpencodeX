# Future Directions

OpencodeX is already pointed at a strong product thesis: keep the terminal as the primary interface, preserve upstream `opencode` compatibility, and turn a single-session coding assistant into a multi-session agent harness. The fork should not become a browser app, a heavyweight IDE, or a generic workflow SaaS. Its best shape is a compact, durable, keyboard-first operations console for many AI coding agents, many models, and many projects.

The next step is to make OpencodeX feel less like "several chats in one TUI" and more like an agent control plane that can remember, schedule, route, react, and recover.

This document reviews the current structure and lays out future feature sets ranked by a blend of user value and implementation difficulty. The rankings are intentionally opinionated. They favor features that strengthen the terminal-native multi-agent harness over features that merely add another integration surface.

## Current Foundation

The README describes OpencodeX as a strict superset of upstream `opencode`: same providers, sessions, MCP servers, plugins, SDK, and storage format, with a new dashboard, project grouping, sidebar, and concurrent-agent status. That is the right foundation. It lets the fork add orchestration without stranding upstream users or fragmenting model/provider support.

Useful existing surfaces:

- `packages/opencode` is the product TUI and server.
- `packages/core` contains the newer Effect-based runtime pieces: config, events, catalog, plugins, policy, location layers, auth, and session primitives.
- `packages/plugin` exposes server hooks and a TUI plugin API with routes, commands, slots, KV, event subscriptions, attention notifications, state access, and client access.
- `packages/opencode/src/skill` already discovers skills from global dirs, project dirs, config paths, and URL indexes.
- `packages/opencode/src/server/routes/instance/httpapi/groups/tui.ts` already exposes experimental TUI control endpoints.
- `packages/opencode/src/server/routes/instance/httpapi/groups/v2/session.ts` already has location-aware v2 session list, prompt, compact, wait, and context routes.
- `packages/slack` is a separate Slack bot wrapper that maps Slack threads to opencode sessions.
- `packages/opencode/specs/tui-plugins.md` shows that TUI plugins are far enough along to become a serious extension layer.
- `specs/v2/provider-policy.md` points toward a shared policy vocabulary, currently starting with provider usage.

The most important design implication is this: OpencodeX does not need to invent every future feature as a monolithic TUI feature. It should define a few durable primitives, then let plugins, skills, SDK clients, and integrations compose around them.

## Product North Star

OpencodeX should become the best terminal-native agent harness for software work:

- It can run locally, over SSH, in WSL, in containers, in CI, and on small servers.
- It can coordinate many sessions at once without hiding blocked prompts.
- It can use many models and providers without making model choice the user's full-time job.
- It can learn project conventions across sessions, but only with understandable provenance and user control.
- It can perform unattended or semi-attended work, but never by silently turning the user's machine into an unsafe automation sink.
- It can react to external events, but those events enter through a governed inbox rather than arbitrary connector code spawning arbitrary work.
- It can preserve the fast terminal feel even as it gains durable scheduling, memory, and integrations.

The product should think of itself as an agent operations console:

1. Sessions are live jobs, not just transcripts.
2. Projects are operational contexts, not just folders.
3. Skills are learned procedures, not just static prompt snippets.
4. External events are triggerable work items, not just messages.
5. Models are resources with cost, latency, capability, reliability, and policy.

## Ranked Roadmap

This ranking blends value and difficulty. Rank 1 is the easiest/highest-value direction. Lower ranks are either harder, less central to the product, or both.

| Rank | Direction | Value | Difficulty | Why it belongs | First useful milestone |
| --- | --- | --- | --- | --- | --- |
| 1 | Better agent/job dashboard | Very high | Low | Extends the current sidebar/dashboard thesis directly | Add queue, labels, last action, blocked reason, cost/time, and quick actions |
| 2 | Project memory and learning proposals | Very high | Medium | Makes multi-session work compound over time | Store learned notes per project and show approval-based AGENTS.md / SKILL.md proposals |
| 3 | Timed actions and wakeups | High | Medium | Converts OpencodeX from reactive TUI to durable harness | Add scheduled prompts that run while `serve` or the TUI is active |
| 4 | External trigger inbox | High | Medium-high | Unifies Slack, Discord, email, webhooks, GitHub, and CI events | Create a normalized trigger inbox with manual approve/run |
| 5 | Expanded policy and permissions for unattended work | Very high | Medium-high | Required before timers and hooks can be trusted | Add policy actions for trigger.run, schedule.run, plugin.load, mcp.connect, file.write |
| 6 | Model routing, fallback, and capability profiles | High | Medium | Supports "as many models as possible" without user friction | Add model profiles, fallback chains, and visible cost/latency metadata |
| 7 | Skill lifecycle and project-local skill authoring | High | Medium | Turns static skills into an evolving project asset | Add skill manager, provenance, update proposals, and skill test prompts |
| 8 | Agent runbooks and reusable workflows | Medium-high | Medium | Lets users launch repeatable multi-agent work from the TUI | Add YAML/JSONC runbooks with steps, agents, models, permissions, and review gates |
| 9 | Remote/headless agent service mode | Medium-high | High | Makes OpencodeX useful over SSH, CI, and persistent machines | Harden `serve` into a durable local control plane with attachable TUIs |
| 10 | Connector framework for Slack/Discord/email/GitHub | Medium-high | High | Valuable, but easy to overbuild | Move `packages/slack` into a connector model after the trigger inbox exists |
| 11 | Observability, replay, evals, and reliability tooling | Medium | Medium-high | Necessary for serious multi-agent use | Add session timeline, event replay, tool latency, model failure summaries |
| 12 | Sandboxed workspaces and environment orchestration | Medium | High | Powerful for safety and parallelism, but platform-sensitive | Make containers/worktrees optional workspace adapters rather than mandatory runtime |
| 13 | Team/shared control plane | Medium | Very high | Useful later, but risks turning the project into SaaS | Start with export/import and shared config, not accounts or cloud sync |
| 14 | Full autonomous project manager | Low-medium now | Very high | Tempting but too broad until primitives mature | Defer until memory, schedules, triggers, policy, and runbooks are stable |

## 1. Better Agent And Job Dashboard

This is the closest, highest-value improvement. OpencodeX already has sessions, projects, live status, pinned sessions, and input-needed detection. The next version should make each session feel like a job with operational metadata.

Simple additions:

- Show a compact "why this needs attention" reason: permission, question, model timeout, failed tool, stopped, done.
- Show runtime duration, last activity, last tool, last file touched, token/cost estimate when available, and model/provider.
- Add quick actions: resume, stop, retry last prompt, compact, rename, pin, move project, copy session ID.
- Add filters: active, blocked, failed, done, project, model, provider, tag.
- Add user labels or tags for sessions.
- Add a "recently completed" band so finished background work is not lost.
- Add a queue view for requested but not started work.

Harder additions:

- Priorities and concurrency limits per provider, model, project, or machine.
- Pause/resume semantics that are more than cancelling a current loop.
- A global agent queue that can run jobs in order and preserve user intent across restarts.
- Retry policies that know whether a failure is model, provider, tool, permission, or context related.

Why this matters: the core differentiator is multi-session orchestration. Every improvement here pays off immediately and does not require inventing a new product surface.

Suggested first milestone:

- Add a richer dashboard row model that derives status reason, last activity, and quick actions from existing synced session state.
- Avoid new persistence at first except optional tags/labels in OpencodeX sidecar state.

## 2. Project Memory And Learning Proposals

The user's idea of agent skills that auto-learn and update on a per-project basis across multiple sessions is one of the strongest directions. It fits OpencodeX better than almost any other feature because the project system already gives the product a durable context boundary.

The key design choice: do not let the agent silently rewrite the rules it will later follow. Let it learn continuously, but commit learned behavior through visible proposals.

Useful memory types:

- Project facts: repo layout, build commands, package manager quirks, test constraints, branch conventions.
- User preferences: preferred implementation style, final-answer style, review expectations.
- Workflow facts: "tests cannot run from repo root", "SDK regeneration command", "default branch is dev".
- Repeated fixes: common failing command and resolution, recurring dependency issue, known flaky test.
- Tool affordances: which MCP servers, plugins, or commands work well in this project.
- Model affordances: which models are good for code review, exploration, long-context planning, fast edits.
- Negative lessons: commands that should not be run, paths that are generated, integrations that are noisy.

Simple version:

- Maintain a project memory ledger in OpencodeX sidecar storage.
- Let agents append proposed learnings at the end of a session.
- Show a "Learnings" inbox in the TUI.
- Let the user accept, reject, edit, or pin learnings.
- Inject accepted project learnings into future sessions as environment context.
- Keep provenance: session ID, timestamp, source prompt, and reason.

Medium version:

- Generate proposed edits to `AGENTS.md`, `.opencode/skills/*/SKILL.md`, or project-local config.
- Use confidence and category labels.
- Detect duplicates and contradictions.
- Add expiry/decay: old facts become stale unless reconfirmed.
- Let users scope memory as global, project, folder, language, agent, or model.
- Add "memory diff" views: what changed since last week, what this agent learned, what this project depends on.

Hard version:

- Automatically synthesize and maintain project skills.
- Evaluate whether a skill actually improves future runs.
- Keep learned skills useful across model families with different prompt sensitivities.
- Resolve conflicts across multiple sessions learning at the same time.
- Prevent malicious or accidental prompt injection from becoming durable project policy.
- Support multi-user memory without leaking private facts.

Recommended architecture:

- Add a `project_memory` sidecar table keyed by OpencodeX project ID, with fields for kind, text, status, provenance, confidence, created/updated times, and optional expiry.
- Add a `memory.propose` internal tool or plugin hook that records candidate learnings but does not directly alter config files.
- Add TUI review commands: Memory Inbox, Accept, Reject, Edit, Promote to AGENTS.md, Promote to Skill.
- Inject accepted memories through the system prompt layer alongside existing project folder context.
- Later, add a `skill.proposeUpdate` flow that writes patch proposals to skill files only after user approval.

This can be inspired by Hermes-like functions if that means durable goals, long-running state, resumable work, and cross-session context. The valuable part is not the exact API; it is the pattern of persistent agent-owned state with explicit user-governed lifecycle.

## 3. Timed Actions And Wakeups

Timed actions would let agents do things such as:

- "Check this PR again in 30 minutes."
- "Every weekday morning, summarize failing CI for this repo."
- "Run a dependency audit next Friday."
- "Remind me to review the generated migration after the current agent finishes."
- "Wake this session tomorrow and continue from the latest issue comments."

Simple version:

- Scheduled prompts stored in sidecar SQLite.
- One-shot wakeups only.
- They run only while the TUI or `opencodex serve` is active.
- The TUI shows upcoming scheduled actions and lets the user cancel or run now.
- Each wakeup targets a project, optional session, agent, model, and prompt.

Medium version:

- Recurring schedules with cron-like syntax and human-readable intervals.
- Missed-run policy: skip, run once on next startup, or catch up.
- Pre-run approval gates for risky actions.
- Per-project and global schedule views.
- Notifications before and after scheduled runs.
- "Wake when condition becomes true" for session idle, PR check finished, file changed, or external trigger received.

Hard version:

- Durable background daemon that runs when no TUI is attached.
- Cross-platform service installation on Windows, macOS, Linux, WSL, containers, and SSH hosts.
- Secure secret storage for scheduled integrations.
- Concurrency, retries, crash recovery, and audit logging.
- Policy-aware unattended permission handling.

Recommendation: start without a daemon. A single binary that can run in virtually any environment should not require service installation to get value. First implement schedules that run under active TUI/headless server processes. Then add optional daemon/service wrappers later.

Suggested first milestone:

- Add `opencodex schedule` and a TUI "Schedules" route.
- Support one-shot wakeups and manual run/cancel.
- Require explicit user approval for any scheduled action that would start a new agent loop.

## 4. External Trigger Inbox

Agents reacting to Discord, Slack, email, webhooks, and similar events is powerful, but it should not start as connector-specific behavior. It should start as a normalized trigger inbox.

External events should become records like:

- source: slack, discord, email, github, webhook, local file watcher, CI
- project: matched OpencodeX project or unknown
- identity: sender, channel, repo, branch, thread
- payload: normalized summary plus raw metadata
- suggested action: ignore, notify, append to session, create session, run runbook
- status: new, approved, running, done, rejected, archived
- policy decision: allowed, denied, approval required

Simple version:

- Add an HTTP endpoint that accepts signed local webhooks or connector plugin events.
- Store events in a trigger inbox.
- Show a TUI inbox with approve/reject/create-session actions.
- Let users define simple project matching rules.

Medium version:

- Connector plugins can register sources and normalize payloads.
- Rules can auto-label, route to project, choose agent/model, and propose prompt.
- Rules can auto-run only for low-risk actions.
- Thread mapping lets Slack/Discord/email conversations attach to sessions.
- Notifications use the existing TUI attention layer.

Hard version:

- Always-on webhooks in hostile networks.
- OAuth install flows for Slack, Discord, Google/Microsoft email, GitHub Apps.
- Secret storage and token refresh.
- Multi-user access control.
- Prompt-injection resistance for untrusted messages.
- Rate limits, dedupe, replay protection, and audit trails.

Recommendation: promote `packages/slack` from a standalone bot into a reference connector only after the trigger inbox exists. Otherwise each integration will invent its own session mapping, permission posture, and UI.

Suggested first milestone:

- Implement a local `trigger.create` route and TUI inbox.
- Add a minimal webhook connector that can submit a trigger with a shared secret.
- Require manual approval to run the agent from a trigger.

## 5. Expanded Policy And Permissions

Unattended work changes the risk profile. A human typing into a prompt is different from a Slack message, webhook, timer, or file watcher creating agent work.

The current provider policy direction is a good start. It should expand into a unified policy vocabulary for agent harness operations.

Potential actions:

- `provider.use`
- `model.use`
- `plugin.load`
- `mcp.connect`
- `trigger.receive`
- `trigger.run`
- `schedule.create`
- `schedule.run`
- `session.create`
- `session.prompt`
- `tool.run`
- `file.read`
- `file.write`
- `shell.run`
- `external_directory.access`
- `secret.read`
- `network.request`

Simple version:

- Add policy checks around schedule.run and trigger.run.
- Default external triggers to approval-required.
- Add source-aware permission context: manual, scheduled, webhook, connector, subagent.
- Show policy denial reasons in the TUI.

Harder version:

- Conditions: source, project, branch, sender, time, repo path, model, agent.
- Organization-managed policy that cannot be overridden by repo config.
- Plugin governance: plugin code is executable code, so policy must distinguish "managed operation" from arbitrary plugin behavior.
- Auditable approvals.

The design should avoid pretending policy is a perfect sandbox. It is a harness-level control plane. For strong isolation, combine it with worktrees, containers, or OS-level sandboxing.

## 6. Model Routing, Fallback, And Capability Profiles

"Works with as many models as possible" should not mean users manually memorize every provider's strengths. The TUI can make model diversity feel manageable.

Simple additions:

- Show model capabilities: context size, vision, tool support, reasoning, JSON reliability, speed, rough cost.
- Let users define model profiles: fast, deep, cheap, review, planning, vision, local.
- Add fallback chains: if provider/model fails, try the next compatible model.
- Track provider/model health in the dashboard.
- Remember per-agent model preferences.

Medium additions:

- Route subagents differently from primary agents.
- Use a small/cheap model for titles, summaries, classification, and memory proposals.
- Let runbooks specify model classes instead of exact model IDs.
- Add "compare models" for one prompt across providers.
- Track model performance by project/task type.

Hard additions:

- Automatic model selection based on task, context size, file types, and past outcomes.
- Quality/cost optimization over multiple steps.
- Provider-specific tool-call quirks and schema transformation.
- Local model support with graceful degradation.

Suggested first milestone:

- Add model profiles in config and a TUI profile picker.
- Keep exact provider/model selection visible, but let profiles become the default mental model.

## 7. Skill Lifecycle And Project-Local Skill Authoring

Skills already exist and can be discovered globally, from project dirs, from config paths, and from URL indexes. The missing piece is lifecycle: discover, inspect, test, update, approve, and retire.

Simple additions:

- Skill manager route in the TUI.
- Show skill name, description, location, source, enabled/denied status, and last used.
- Open/copy skill location.
- Show which agent permissions allow or deny each skill.
- Add "create project skill" from a prompt.

Medium additions:

- Track skill usage and outcomes.
- Let agents propose skill updates.
- Add skill tests: sample prompts that should trigger the skill and expected behavior.
- Add skill version/provenance metadata.
- Add project skill packs.

Hard additions:

- Auto-generated skills that are kept current as the repo evolves.
- Skill conflict detection.
- Skill portability across projects.
- Skill marketplace and trust model.

Recommended stance: skills should become the first-class way agents learn procedural project knowledge, but updates should pass through a review queue. Auto-learning is valuable; auto-committing instruction changes is dangerous.

## 8. Agent Runbooks And Reusable Workflows

Runbooks are repeatable workflows that can coordinate one or more sessions.

Examples:

- "Review this PR": scout changed files, summarize risks, run targeted checks, produce review.
- "Prepare release": inspect changelog, check version, build artifacts, draft release notes.
- "Fix CI": inspect latest logs, identify failure, propose patch, wait for rerun.
- "Explore dependency": create research session, summarize options, propose migration plan.

Simple version:

- User-authored JSONC/YAML runbooks.
- Steps can prompt a specific agent/model, wait for idle, ask for approval, or create a sub-session.
- Runbooks appear in the command palette.

Medium version:

- Variables and inputs.
- Branch/project/session binding.
- Built-in review gates.
- Runbook progress shown in the dashboard.
- Runbook templates shipped with OpencodeX.

Hard version:

- Conditional logic.
- Parallel fanout/fanin.
- Error handling and retries.
- Cross-project workflows.

Runbooks are a better near-term target than "full autonomous project manager" because they keep users in control and build on existing sessions.

## 9. Remote And Headless Service Mode

To run in virtually any environment, OpencodeX should work in:

- Local terminal.
- SSH session.
- WSL.
- Dev container.
- CI shell.
- Long-running server or VM.
- Attached/detached TUI.

The current server and SDK are already useful. The future direction is to make the headless process a durable control plane.

Simple additions:

- Make attach/detach workflows obvious in the README and TUI.
- Show server URL, auth state, and connected clients.
- Persist schedule/trigger/job state locally.
- Add `opencodex attach` ergonomics.

Hard additions:

- Cross-platform daemon install.
- Process supervision.
- Secure remote access.
- TLS and auth for non-local networks.
- Multi-user session access.

Recommendation: optimize for "user starts a headless server in tmux/systemd/CI" before building native service managers. That preserves the "runs anywhere" goal.

## 10. Connector Framework

Slack, Discord, email, GitHub, GitLab, Linear, Jira, PagerDuty, and CI systems can all be useful. But connectors should not be the foundation. The foundation should be trigger inbox + policy + schedules + runbooks.

Once those exist, connectors become much simpler:

- Receive external event.
- Normalize payload.
- Match project/session.
- Create trigger.
- Optionally post status updates.

Connector difficulty varies:

- Simple: local webhook, GitHub webhook, file watcher, CLI-triggered event.
- Medium: Slack Socket Mode, Discord bot, GitHub App with checks, Linear/Jira.
- Hard: email with OAuth, multi-tenant Slack installs, enterprise SSO, bidirectional state sync.

Features that probably belong:

- Slack/Discord thread to session mapping.
- GitHub PR comment to session mapping.
- CI failure to "fix CI" runbook.
- Email-to-inbox for manual approval.

Features that probably do not belong:

- A full Slack client.
- A full email client.
- A generic Zapier clone.
- Complex team workflow approvals before local single-user harness primitives are stable.

## 11. Observability, Replay, Evals, And Reliability

Multi-agent orchestration needs trust. Users need to know what happened and why.

Simple additions:

- Timeline view per session: prompts, model calls, tool calls, permissions, errors, compactions.
- Tool latency and failure summaries.
- Provider/model failure counts.
- Cost/token summaries when available.
- Export session/job diagnostics.

Medium additions:

- Replay a session from event log where possible.
- HTTP recorder integration for provider/tool regressions.
- Golden task evals for runbooks and skills.
- "Why did this agent stop?" diagnostics.

Hard additions:

- Deterministic replay across model providers.
- Automated quality scoring.
- Cross-model comparative evals.

This work is less glamorous than external triggers, but it is what lets OpencodeX become dependable instead of merely impressive.

## 12. Sandboxed Workspaces And Environment Orchestration

The repo already has `packages/containers` and plugin workspace adapter concepts. This can become a major differentiator, but it is platform-sensitive and should stay optional.

Possible workspace modes:

- Current working directory.
- Git worktree.
- Temporary clone.
- Container.
- Remote VM.
- WSL path.
- Read-only reference workspace.

Simple additions:

- Better worktree creation and switching from TUI.
- Per-session workspace labels.
- Clear trust roots in the UI.

Hard additions:

- Container lifecycle.
- File sync.
- Secrets injection.
- OS-specific sandboxing.
- Remote execution.
- Cleanup of abandoned environments.

Recommendation: make workspace adapters a plugin-extensible substrate. Do not require containers for normal use.

## 13. Team And Shared State

Team features could be powerful, but they can also pull the project away from terminal-native local strength.

Low-risk team features:

- Export/import project config.
- Shareable runbooks.
- Shareable skill packs.
- Session summary export.
- Local network attach with explicit auth.
- Git-backed project memory.

High-risk team features:

- Multi-user cloud dashboard.
- Hosted background agents.
- Centralized secret store.
- Organization policy management.
- Billing and identity.

Recommendation: first build local primitives that can later sync. Do not make SaaS a prerequisite for power.

## 14. Full Autonomous Project Manager

The idea is attractive: an agent that watches everything, decides what matters, assigns subagents, fixes issues, follows up, and reports progress. It is also the easiest way to make the product unreliable.

This should be a late composition of mature primitives:

- Project memory.
- Schedules.
- Trigger inbox.
- Runbooks.
- Policy.
- Model routing.
- Observability.
- Sandboxed workspaces.

Until those exist, "autonomous project manager" should remain a demo mode or runbook, not a core default behavior.

## Cross-Cutting Design Principles

### Keep The TUI As The Control Plane

Even when work is triggered by timers or external systems, the TUI should be where users see state, approve risky actions, inspect history, and regain control.

### Prefer Inboxes Over Invisible Automation

Memory proposals, triggers, scheduled runs, skill updates, and risky permissions should flow through reviewable queues. Users should be able to trust that OpencodeX is working for them, not silently changing its own behavior.

### Make Unattended Work Explicitly Different

A manual prompt, timed prompt, Slack trigger, and webhook trigger should carry different source metadata. Permission and policy decisions should be able to depend on that source.

### Build Primitives Before Connectors

Slack and Discord are useful, but the reusable primitive is "external event became a governed trigger." Timers are useful, but the reusable primitive is "durable scheduled action." Skills are useful, but the reusable primitive is "reviewed durable project learning."

### Keep Upstream Compatibility Sacred

OpencodeX should continue to preserve upstream sessions, providers, plugins, and SDK behavior where possible. New features should live in sidecar tables, namespaced routes, or additive plugin/TUI surfaces unless there is a strong reason to touch upstream shapes.

### Support Many Models Through Abstraction, Not Flattening

Do not pretend every model has the same capabilities. Capture differences, expose them clearly, and route around them.

### Default To Local, Allow Remote

The product should be excellent as one binary in a terminal. Remote service mode, connectors, and team features should extend that, not replace it.

## Suggested Phases

### Phase 1: Make The Current Cockpit Operational

- Rich dashboard/job rows.
- Tags, quick actions, blocked reasons.
- Project memory ledger with manual learning proposals.
- Skill manager basics.
- One-shot scheduled prompts while TUI/server is active.
- Policy checks for schedule.run and trigger.run.

### Phase 2: Add Governed Automation

- Trigger inbox.
- Local webhook connector.
- Recurring schedules.
- Runbooks with approval gates.
- Model profiles and fallback chains.
- Memory-to-AGENTS.md and memory-to-SKILL.md proposal flows.

### Phase 3: Add Connectors And Headless Durability

- Harden `serve` and attach flows.
- Slack connector through trigger inbox.
- GitHub PR/CI connector.
- Discord connector if demand is real.
- Observability timeline and diagnostics.
- Optional daemon/service wrappers.

### Phase 4: Advanced Orchestration

- Parallel runbooks.
- Automatic model routing.
- Workspace adapters for containers/worktrees/remotes.
- Skill tests and skill quality tracking.
- Team-shareable packs and policy.

## What Should Not Belong Yet

Some ideas are powerful but should be resisted until the core harness is mature:

- Full email client or Slack client behavior.
- A general-purpose automation platform unrelated to agent work.
- Cloud-first multi-user SaaS control plane.
- Silent auto-editing of project instructions or skills.
- Always-on daemon as a required installation path.
- Complex organization administration before local policy is solid.
- A custom model provider ecosystem that fights upstream/provider catalog compatibility.

## Best Immediate Bets

The strongest next bets are:

1. Richer agent/job dashboard.
2. Project memory with reviewable learning proposals.
3. One-shot scheduled prompts.
4. Trigger inbox with manual approval.
5. Expanded policy for unattended sources.
6. Model profiles and fallback chains.
7. Skill lifecycle management.

These features reinforce each other. Memory makes repeated sessions better. Schedules and triggers create more background work. Policy keeps that background work safe. The dashboard makes it visible. Model routing keeps it portable across providers. Skills turn recurring knowledge into reusable procedure.

That is the path from a better `opencode` TUI to a genuinely powerful terminal-native agent harness.
