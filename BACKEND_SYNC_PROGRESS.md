# Backend Synchronization Progress

Last updated: 2026-08-10

## Goal

Make the GUI, TUI, SDK clients, jobs, swarms, and session execution state converge through one authoritative backend per database.

The current design assumes a single backend authority for each SQLite database. Active-active backend writers are out of scope; a second backend must attach to the existing authority or fail. Persistent correctness must not depend on `/global/event`, which remains a transient low-latency notification channel.

## Completed Work

### Durable state and migration infrastructure

- Added TypeScript-driven database migration application with immediate transactions and a migration journal.
- Added durable OpencodeX state-event coherence data, visibility scopes, aggregate sequence tracking, database identity, and session card cursor support.
- Added durable session execution, status, interaction, and command tables.
- Added command ownership fields: `owner_id`, `claim_generation`, and `lease_expires_at`.
- Added a unique `(session_id, message_id)` command index for idempotent prompt submission.
- Added `20260721055823_amazing_madrox` as a no-op Drizzle reconciliation marker. Its generated SQL snapshot records schema already introduced by the preceding hand-written sidecar migrations.
- The expected migration count is now **44** — the count is asserted dynamically against `migrations.length` in `packages/core/test/database-migration.test.ts`, so it does not need to be edited here when a migration is added. The last four are from the cleanup branch: `20260728232403_cooing_arachne` (adds `event_aggregate_seq_idx` on `event(aggregate_id, seq)`), `20260728234513_yielding_loners`, `20260729003748_great_unus` (drops `session_share` and `session.share_url`), and `20260729023717_married_marrow` (drops `account`, `account_state`, `control_account`).
- Fixed the previously blocking migration failure where `session_command_lease_idx` referenced a missing `lease_expires_at` column.

Relevant files:

- `packages/core/src/database/migration.ts`
- `packages/core/src/database/migration.gen.ts`
- `packages/core/src/database/migration/20260720000000_opencodex_state_coherence.ts`
- `packages/core/src/database/migration/20260720010000_session_execution.ts`
- `packages/core/src/database/migration/20260721055823_amazing_madrox.ts`
- `packages/core/migration/20260721055823_amazing_madrox/`
- `packages/core/src/session/sql.ts`
- `packages/core/test/database-migration.test.ts`

### Event journal retention (cleanup branch, 2026-07-29)

- `packages/core/src/event/retention.ts` compacts the append-only `event` journal on a 60s loop, keeping the **first and last** revision per entity for `message.part.updated.1`, `message.updated.1`, and `session.updated.1`. Created/deleted/removed events are never touched, and no aggregate is time-pruned as a whole, so session warp and `/sync/history` still replay onto identical rows.
- Because deletion makes sequence numbers sparse, `commitSyncEvent` and `replayAll` were relaxed from **dense** to **strictly increasing** sequences.
- `event_aggregate_seq_idx` on `event(aggregate_id, seq)` backs both the compaction pass and replay (migration `20260728232403_cooing_arachne`).
- `Session.updatePart` gained a `transient` option so in-flight tool progress broadcasts without writing a journal row, and `ctx.metadata` is coalesced per tool call on a 100ms leading+trailing window. Terminal tool state (`ensureToolCall`, `completeToolCall`, `failToolCall`) stays durable.
- Coverage: `packages/core/test/event/retention.test.ts`, `packages/core/test/event.test.ts`, `packages/opencode/test/session/tools.test.ts`.

### Atomic project, view, and session-state mutations

- Project rows, folder mappings, session membership, and durable events now commit in immediate transactions.
- Session moves atomically update metadata and project membership.
- Explicit session creation retries repair project membership.
- Stale session metadata no longer overwrites authoritative project metadata.
- View create, update, reorder, and delete operations commit atomically with durable events.
- View replacement requires `expectedTimeUpdated`; stale writers receive HTTP 409.
- Reviewed-file replacement requires `expectedReviewedFiles`; stale full-list replacement receives HTTP 409 while commutative `seenAt` and `reviewedAt` updates remain independent.
- GUI and TUI callers use the new compare-and-swap preconditions.

Relevant files:

- `packages/opencode/src/opencodex/project.ts`
- `packages/opencode/src/opencodex/project-folder.ts`
- `packages/opencode/src/opencodex/view.ts`
- `packages/opencode/src/opencodex/session-state.ts`
- `packages/opencode/test/opencodex/project.test.ts`

### Job and swarm concurrency

- Removed eager recovery before settlement handlers are registered.
- Recovery can settle exhausted or cancelled jobs transactionally.
- Job transitions acquire the durable event barrier before opening SQLite transactions.
- Dispatcher cancellation wins terminal-state races.
- Swarm run graphs, jobs, assignments, and durable events commit atomically.
- Active-run creation is serialized by a transaction and authoritative compare-and-swap check.
- Swarm mutations, status aggregation, and execution use consistent event barriers.
- Cancellation takes precedence over synthesis and other terminal updates.
- Terminal run updates and synthesis settlement are compare-and-swap guarded.
- Generic job HTTP endpoints reject internal `swarm.*` jobs.
- Added concurrent assignment, internal-job access, and cancellation-before-synthesis regressions.

Relevant files:

- `packages/opencode/src/opencodex/job-store.ts`
- `packages/opencode/src/opencodex/job-lifecycle.ts`
- `packages/opencode/src/opencodex/job-dispatcher.ts`
- `packages/opencode/src/opencodex/job-service.ts`
- `packages/opencode/src/opencodex/swarm-run.ts`
- `packages/opencode/src/opencodex/swarm-mutations.ts`
- `packages/opencode/src/opencodex/swarm-status.ts`
- `packages/opencode/src/opencodex/swarm-execution.ts`
- `packages/opencode/test/opencodex/job.test.ts`

### Durable session execution and commands

- Session status writes carry execution generation context.
- An old execution generation cannot publish busy, retry, or idle status over a newer generation.
- Cancellation targets only the matching local execution owner.
- Command claims use compare-and-swap ownership and monotonically increasing claim generations.
- Running command leases are renewed by heartbeat.
- Command settlement is fenced by owner and claim generation.
- `promptAsync` retries reuse an existing command and use conflict-safe insertion.
- Abort marks both active and queued commands cancelled.
- Added generation takeover, stale status, prompt retry, queued cancellation, and post-release settlement regressions.

Relevant files:

- `packages/opencode/src/session/execution-owner.ts`
- `packages/opencode/src/session/prompt-recovery.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/run-state.ts`
- `packages/opencode/src/session/status.ts`
- `packages/opencode/test/session/prompt.test.ts`
- `packages/opencode/test/session/durable-execution.test.ts`

### GUI, TUI, SDK, and stream convergence

- Capability fixtures now include required `scope` and `epoch` fields.
- Durable state-event fixtures include required `position` and `visibility` fields.
- The TUI preserves off-page project/view assignment IDs while filtering hydrated session objects.
- The TUI follows bounded authoritative session-message pages to completion before marking a transcript synchronized; sessions longer than the initial 100-message tail no longer lose older GUI messages.
- The GUI persists its normalized backend database selection in shared local state, and core/TUI/CLI database resolution honors it unless `OPENCODE_DB` explicitly overrides it.
- Mixed-version TUI launches can discover exactly one healthy coordinator with an active GUI lease, preventing branch-channel reinstalls from silently opening a new empty database.
- First-upgrade TUI launches without a marker or active GUI select the populated OpencodeX database deterministically, then persist that authority for subsequent launches.
- TUI project/session projection is cross-project by default; exact-directory filtering remains an explicit opt-in command instead of making launches from the home directory look empty.
- The SDK flushes bootstrap frames before reconnect generation changes.
- Client-observed sequence gaps now preserve canonical/session state and reconnect from the last good cursor so the server can replay the missing sequence.
- Heartbeat identity mismatches and explicit `reset_required` boundaries still perform a canonical rebootstrap.
- SSE overflow discards the queued partial history and emits one explicit `reset_required` boundary.
- The GUI enables a one-second authoritative snapshot/capability poll as a correction path when the SSE stream is connected but misses or delays an invalidation.
- Poll refreshes are coalesced and never overlap; durable SSE remains the low-latency primary path.
- The GUI keeps its last coherent snapshot and selected/view session caches visible during rebootstrap, then atomically reconciles the replacement ready state instead of showing a full-screen loading cycle.
- Normal TUI prompts use durable `promptAsync` admission instead of depending on one long-lived synchronous HTTP request.
- Canonical TUI state sync consumes session/message events across directories while directory-scoped feature consumers retain their local event filter.
- Raw global SSE subscribes before publishing `server.connected`; the TUI proves the lazy stream is open before starting projectors and automatically corrects retained transcripts after reconnect.
- Failed retained-session corrections retry with bounded backoff, remain visually non-blocking, and root polling corrects transcripts when an updated session card is observed without an event.
- Durable session invalidations no longer suppress content-bearing raw message events with the same EventV2 ID.
- TUI reconnects are silent and automatic; the transient `Connection interrupted` banner was removed.
- Todo replacement and its `todo.updated` event now commit in one transaction.
- Generated SDK callers include the view and reviewed-file compare-and-swap fields.

Relevant files:

- `packages/opencode/src/session/todo.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/opencodex-state-handlers.ts`
- `packages/opencode/src/cli/cmd/tui/coordinator-registry.ts`
- `packages/opencode/src/cli/cmd/tui/database-discovery.ts`
- `packages/core/src/database/database.ts`
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`
- `packages/opencode/src/cli/cmd/tui/context/event.ts`
- `packages/opencode/src/cli/cmd/tui/component/prompt/submit-session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`
- `packages/gui/src/main/backend-authority.ts`
- `packages/gui/src/main/sidecar.ts`
- `packages/sdk/js/src/v2/client-sync-controller.ts`
- `packages/sdk/js/src/v2/client-sync-transport.ts`
- `packages/sdk/js/test/client-sync.test.ts`
- `packages/gui/src/renderer/src/controllers/authoritative-state-applicator.ts`
- `packages/gui/test/authoritative-state-applicator.test.ts`
- `packages/gui/test/state-contract.parity.test.ts`
- `packages/gui/test/subscribe-events.test.ts`

### Bounded durable-event retention and replay

- Added one database-global journal retention policy instead of a per-scope policy that allowed total growth to remain unbounded.
- Retention now keeps at most 100,000 state events and seven days of history, deleting at most 5,000 rows per immediate transaction.
- Maintenance runs once at state-log startup and then every minute from one scoped database-global fiber.
- Maintenance acquires the EventV2 barrier before SQLite, preserving the authority lock order used by event writes.
- The durable global retention floor advances atomically with deletion.
- Cursor position and domain revision vectors remain at least the durable floor, so pruning every visible row cannot create a permanent reset loop or make revisions move backward.
- Cursor positions are treated as journal boundaries; replay no longer requires the exact cursor row to remain present.
- Replay reads at most 513 rows and requests a reset when more than 512 events would be replayed.
- Cross-graph draining reads bounded 1,024-row pages instead of materializing the full unseen journal.
- Cursor input is capped before base64/JSON decoding.
- Added deterministic coverage for bounded deletion, periodic catch-up, complete visible-history deletion, monotonic revision vectors, and bounded replay reset.
- Updated the SDK retention test to verify reset/rebootstrap without changing epoch or database identity.

Relevant files:

- `packages/opencode/src/opencodex/state-log.ts`
- `packages/opencode/test/opencodex/state-log.test.ts`
- `packages/sdk/js/test/client-sync.test.ts`

### Replay and transaction lock ordering

- Core EventV2 replay now invokes registered durable sync handlers in the same transaction as projector and event-journal persistence.
- Duplicate, stale-sequence, and wrong-owner replay attempts do not invoke durable sync handlers.
- Permission, question, and session-status mutations acquire the EventV2 barrier before opening immediate SQLite transactions, removing the SQLite/event-barrier deadlock cycle.
- Added replay-handler regression coverage; existing permission, question, and durable execution suites remain green.

Relevant files:

- `packages/core/src/event.ts`
- `packages/core/test/event.test.ts`
- `packages/opencode/src/permission/index.ts`
- `packages/opencode/src/question/index.ts`
- `packages/opencode/src/session/status.ts`

### Settings and plugin persistence

- Npm package cache directories now use fixed SHA-256 keys rather than raw package specifications.
- Npm fallback paths require a parsed package name, and Arborist targets outside their cache slot are rejected.
- Filesystem containment rejects sibling, absolute-relative, cross-drive, and UNC escapes.
- OpenCodeX settings now return a content revision and require `expectedRevision` on update.
- Settings compare under a cross-process lock, preserve unknown fields, write through a same-directory temporary file, and return HTTP 409 for stale updates.
- Malformed settings are reported and left byte-for-byte unchanged instead of being interpreted as empty state.
- GUI and E2E settings callers retain and send the revision.
- Plugin installation canonicalizes relative paths against the authoritative instance directory and persists a stable `file://` specification.
- Local `.opencode` symlink/junction escapes are rejected before any write.
- Server and TUI plugin config updates use one scope lock, validate every target before writing, atomically replace production files, and roll back earlier targets if a later write fails.
- TUI plugin enable writes use the same scope lock and atomic replacement.
- Successful backend server-plugin changes dispose/reload the affected instance, or all instances for global changes, after persistence commits.
- Production TUI plugin installation now calls the backend authority and no longer writes backend paths on the TUI host.
- TUI plugin enable/disable now persists through the backend before runtime activation changes; stale device KV state no longer overrides backend `plugin_enabled` configuration.
- The standalone `plug` command sends mutations to an active coordinator and treats coordinator health/auth/request failure as terminal instead of falling back to a competing direct write.
- Settings and plugin-config mutations publish durable invalidations. Plugin clients refresh capability snapshots, and GUI settings refetch when the authoritative capability revision changes.
- Added cache-key, containment, stale settings, malformed settings, plugin rollback, config symlink, canonical relative path, backend-routed TUI install/toggle, coordinator-routed CLI, and durable event-scope regressions.

Relevant files:

- `packages/core/src/npm.ts`
- `packages/core/src/filesystem.ts`
- `packages/core/test/npm.test.ts`
- `packages/opencode/src/opencodex/settings.ts`
- `packages/opencode/test/opencodex/settings.test.ts`
- `packages/opencode/src/plugin/install.ts`
- `packages/opencode/src/plugin/shared.ts`
- `packages/opencode/src/util/filesystem.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/opencodex-plugin-handlers.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime-install.ts`
- `packages/opencode/test/plugin/install.test.ts`
- `packages/opencode/test/cli/tui/plugin-toggle.test.ts`

### Streaming responsiveness and reconnect hardening

- TUI raw global events now publish one normalized batch on a fixed 16 ms delivery window. Slow rendering can no longer collapse the queue into immediate one-token flushes.
- The TUI authoritative controller applies each batch with one `applyEvents(...)` call, allowing contiguous text and reasoning deltas to reduce into one state commit and projection instead of one commit per delta.
- TUI projection is differential by canonical reference: catalog, operations, capabilities, and session details reconcile only when their domain changes.
- Live detail batches carry exact session, message, and part hints through the synchronous controller notification, so streaming deltas update only the named Solid store node instead of traversing or reconciling every retained transcript.
- Structural snapshots, pagination, removals, reconnects, and local directory-filter refreshes still perform full canonical reconciliation where required.
- New-session prompts hydrate a canonical tail before durable submission so early message and delta events cannot fall into the cold-detail gap.
- TUI submissions retain a message-keyed pending marker through idle command handoffs. It keeps sidebar and composer status continuously in progress, clears when the matching assistant response starts, and releases after cancellation from raw events or authoritative reconnect correction.
- Hidden directory-filtered sessions cannot be reinserted by later off-directory detail deltas.
- Client session details retain an explicit transient text/reasoning delta overlay keyed by the persisted part base. Tail corrections reapply live text only when the authoritative base still matches, so stale snapshots cannot erase earlier response lines.
- Differing or completed authoritative parts clear the overlay, while buffered pre-hydration deltas and overlays outside an older-page snapshot remain protected. Part/message removal clears the corresponding transient state.
- Lightweight feature listeners still receive individual events after authoritative state applies.
- The backend state-log listener no longer runs a SQLite drain for transient, non-durable streaming deltas; periodic catch-up still detects durable rows written by another event graph.
- GUI and TUI client lease heartbeats now serialize writes and atomically rename same-directory temporary files over the active lease.
- The coordinator preserves a recent malformed lease whose filename belongs to a live process, preventing a replacement window from being mistaken for the final client disappearing.
- The GUI transport now asks Electron main to health-check and restart the coordinator after a network or authorization failure, retries the original request against the new origin, and updates the existing GUI client connection in place.
- The GUI reconnect warning remains hidden for routine stream renewal and the first retry. It appears only after stale authoritative state has failed a full reconnect attempt.
- GUI prompt submission now waits for an explicit admission result, rehydrates a missing active-session card before preflight, preserves optimistic composer drafts when admission fails, and surfaces missing connection/session or transport failures through the notice controller.
- New-session route handoff and external prompt clearing happen only after the prompt or command endpoint accepts the submission.
- GUI request recovery buffers SDK request bodies before changing coordinator origins. Chromium no longer receives a local HTTP/1 streaming upload with `duplex: half`, which previously rejected prompt POSTs as `Failed to fetch` before they reached the backend.
- OpenAI no longer receives an implicit 10-second response-header timeout. Slow valid model starts were being aborted as `MessageAbortedError`, so both GUI and TUI displayed `interrupted`; response-header timeouts remain available as an explicit provider option.
- Added regressions for TUI batch delivery, lease replacement scanning, GUI sidecar recovery, reconnect-warning gating, failed prompt admission, and POST body/auth preservation across sidecar recovery.

### Hub workspace mirror and per-directory sync scoping

- Added a `hub` section to `opencode.json` (`url`, optional `username`/`password`), with `OPENCODE_HUB_URL` / `OPENCODE_HUB_PASSWORD` env overrides; the username/password fall back to the server auth defaults. Schema annotations flow into the auto-generated config reference.
- Added a builtin `hub` workspace adapter: a project configured with a hub URL lists its remote workspaces through the existing `syncList` discovery (zero extra bootstrap), stores the resolved target in the workspace's persisted `extra`, and resolves to a `{ type: "remote", url, headers }` target so existing workspace routing proxies sessions to the hub.
- Added optional `?directory=` scoping to `/sync/history` while retaining the upstream bare `state` request body. When supplied, events are filtered to aggregates that belong to the requested directory and `[]` is returned when that directory has no sessions; callers that omit it retain the upstream full-journal behavior. This lets one hub host multiple projects without leaking session events across them without breaking existing clients.
- Regenerated the JavaScript SDK so `sync.history.list` exposes the existing bare `body` state map plus the optional `directory` query parameter, and updated the CLI SDK error-shape and HTTP sync tests for the additive contract.
- Added `Workspace.Service.warpToHub`: when a session is created over HTTP in a project that has a `hub` workspace, the session is warped into that workspace immediately (`copyChanges: false`, replay + steal), so GUI-created sessions auto-mirror to the hub. The warp is best-effort and bounded (5s timeout): a flaky hub degrades to a normal local session instead of failing session creation.
- Added the `hub` adapter and `warpToHub` coverage in the control-plane adapter/workspace suites and the per-directory scoping regression in the HTTP sync suite.

Relevant files:

- `packages/opencode/src/config/hub.ts`
- `packages/opencode/src/control-plane/adapters/hub.ts`
- `packages/opencode/src/control-plane/adapters/index.ts`
- `packages/opencode/src/control-plane/workspace.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/sync.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts`
- `packages/opencode/test/control-plane/{adapters,workspace}.test.ts`
- `packages/opencode/test/server/httpapi-sync.test.ts`
- `packages/opencode/test/server/sdk-error-shape.test.ts`

## Verification Completed

The following commands pass in the current worktree:

```text
packages/core:
  bun test test/event.test.ts test/npm.test.ts test/database-migration.test.ts --timeout 30000
  Result: 36 passed

  bun script/migration.ts --check
  Result: No schema changes, nothing to migrate

  bun run typecheck

packages/opencode:
  bun test test/provider/header-timeout.test.ts test/provider/provider.test.ts --timeout 30000
  Result: 95 passed

  Focused state, HTTP, settings, agent, plugin, permission, question, session, project, and job suites
  Result: 280 passed, 14 skipped

  bun test test/cli/cmd/tui/sync.test.tsx --timeout 30000
  Result: 6 passed

  bun test test/cli/coordinator-selection.test.ts --timeout 30000
  Result: 5 passed

  bun test test/cli/tui/sync-state.test.ts --timeout 30000
  Result: 1 passed

  bun run typecheck

packages/sdk/js:
  bun test test/client-sync.test.ts --timeout 30000
  Result: 67 passed

packages/gui:
  bunx playwright test e2e/prompt-state-stream.spec.ts
  Result: 1 passed; Chromium prompt POST reached backend and completed

  bun test --conditions=browser test
  Result: 489 passed

  bun run typecheck

  bun test test/authoritative-state-applicator.test.ts test/authoritative-state-changes.test.ts test/state-contract.parity.test.ts test/session-hydration.test.ts test/subscribe-events.test.ts test/session-presentation.test.ts --timeout 30000
  Result: 33 passed

  bun test test/backend-authority.test.ts test/sidecar-connection.test.ts test/sidecar-lifecycle.test.ts --timeout 30000
  Result: 10 passed

  bun run build:main
  Result: Electron main and preload bundles built with validated externals

TUI reconnect synchronization:
  bun test test/cli/cmd/tui/sync.test.tsx test/cli/cmd/tui/sync-undefined-messages.test.tsx test/cli/tui/sync-state.test.ts test/cli/tui/use-event.test.tsx --timeout 30000
  Result: 15 passed (sync-v2.test.tsx retired with the v2 event system)

TUI status and prompt lifecycle:
  bun test test/cli/cmd/tui/opencodex-session-viewed.test.ts test/cli/cmd/tui/notifications.test.ts --timeout 30000
  Result: 8 passed

  bun test test/session/prompt.test.ts test/session/durable-execution.test.ts --timeout 30000
  Result: 53 passed, 14 skipped

Coordinator lifecycle:
  bun test test/cli/coordinator-selection.test.ts --timeout 30000
  Result: 6 passed

  bun test test/cli/gui-coordinator.test.ts --timeout 60000
  Result: 7 passed

Backend state log and HTTP state API:
  bun test test/opencodex/state-log.test.ts test/server/opencodex-state-httpapi.test.ts --timeout 30000
  Result: 11 passed

GUI reconnect and sidecar lifecycle:
  bun test test/client-recovery.test.ts test/connection-warning.test.ts test/backend-authority.test.ts test/sidecar-connection.test.ts test/sidecar-lifecycle.test.ts test/subscribe-events.test.ts --timeout 30000
  Result: 13 passed

  bun run build:main
  Result: Electron main and preload bundles built with validated externals

repository root:
  git diff --check
  Result: passed

installed Windows TUI:
  Version: 0.0.0-codex/recover-opencodex-foundation-202607212149
  Database: opencode-feature-gui.db
  Catalog: 2 projects, 171 sessions
```

## Remaining Work

### Residual architecture follow-ups

Status as of the 2026-07-29 cleanup branch: **1 of 5 resolved**, 4 still open.

- **OPEN** — Settings and plugin configuration changes publish dedicated durable mutation events, but there is no filesystem-to-event outbox. Crash recovery between a file commit and event publication is not yet modeled.
- **OPEN** — Multi-target plugin writes stage and roll back process-level failures, but there is no durable transaction journal for a process crash between the two atomic renames.
- **RESOLVED (2026-07-29)** — ~~The separate core EventV2 `event` journal and `/sync/history` protocol remain unbounded.~~ The journal is now bounded by `packages/core/src/event/retention.ts` (see *Event journal retention* above) and indexed by `event_aggregate_seq_idx`. The concern that retention "must not silently delete remote-sync history" is satisfied structurally rather than by an acknowledgment protocol: compaction only drops *intermediate revisions of an entity that is still present*, never a created/deleted/removed event and never a whole aggregate, so any replay — including a remote client resuming from an old sequence — lands on identical rows. Remote acknowledgment/reset semantics are therefore no longer a prerequisite for pruning.
- **OPEN** — One-coordinator-per-database is enforced by GUI/TUI launch paths, not universally by `Database.defaultLayer`; an independently launched generic server can still open the same SQLite file. (The cleanup branch added a coordinator version handshake, which narrows client/server mismatch but does not change who may open the file.)
- **OPEN** — Add a full backend restart test with a deliberately slow state client, pruning, reset, snapshot replacement, and final multi-client convergence. Current deterministic state-log, HTTP handoff, SDK reset, and GUI parity tests cover the individual boundaries but not one long-running process-level soak.

### Final validation

For future follow-up work:

1. Regenerate the JavaScript SDK with `bun packages/sdk/js/script/build.ts` if HTTP schemas changed.
2. Run migration reproducibility and the core migration tests from `packages/core`.
3. Run focused state-log, server state API, prompt, durable execution, project, job, TUI sync, SDK sync, and GUI parity tests from their package directories.
4. Run typechecks for `packages/core`, `packages/opencode`, `packages/sdk/js`, and `packages/gui`.
5. Run `git diff --check` from the repository root.
6. Keep the bounded restart/soak test as the final convergence gate.

## Worktree Notes

- The synchronization work described above is committed; the "intentionally dirty worktree" note that used to live here no longer applies.
- Migration source and generated reconciliation artifacts must remain consistent. Run `bun script/migration.ts --check` from `packages/core` after schema changes.
- Tests cannot run from the repository root; use the affected package directory.
- The SDK generation command is `bun packages/sdk/js/script/build.ts` from the repository root.

## Recommended Resume Order

1. Add a recoverable filesystem outbox for settings/plugin invalidations and a durable transaction journal for multi-file plugin replacement.
2. ~~Define remote acknowledgment/reset semantics for the core EventV2 journal before adding core-history retention.~~ Done 2026-07-29 — retention landed without needing the protocol; see *Event journal retention*.
3. Enforce one authority per database below the GUI/TUI coordinator launch paths if generic standalone servers must share the same invariant.
4. Add the process-level restart/slow-client convergence test.
