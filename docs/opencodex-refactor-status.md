# OpencodeX Refactor Status

Last updated: July 10, 2026

Working branch: `codex/recover-opencodex-foundation`

Integration base: `origin/main`

## Executive summary

The recovery refactor has moved OpencodeX from a red, difficult-to-review prototype to a green architectural foundation. Repository checks are deterministic, the server and SDK now have a credible authoritative-state protocol, Jobs have a persisted lifecycle, Swarms create linked Jobs, and the Electron boundary is materially safer.

This is not yet a production-ready ADE. The highest-risk cutovers are incomplete:

- Both first-party clients now bootstrap and reduce session, catalog, and capabilities state through `ClientStateSync` without calling legacy `session-sync`; capabilities are an atomic server domain and the required cross-client fixture matrix is in place.
- Job state transitions and their durable events now commit together, and a lease-owning dispatcher executes registered Job kinds with heartbeat, timeout, retry, cancellation, dependency, recovery, and graph-readiness behavior.
- Every Swarm phase now executes through dispatcher-owned Jobs. The remaining automation gap is proving restart/race behavior and making cross-aggregate Swarm settlement atomic.
- The largest GUI and TUI modules remain too broad. Request-level performance invariants now have focused coverage, but CPU, render, memory, and realistic large-catalog budgets are not yet established.
- Release workflows are substantially hardened, but the signed, clean-checkout, cross-platform release gate has not yet been proven end to end.

Jobs and Swarms should remain explicitly experimental until the automation acceptance gate is complete.

## Delivery snapshot

The original ADE work is preserved at `codex/opencodex-wip-baseline` (`2b01725`). The recovery work is organized into four commits after that archival point:

| Commit    | Purpose                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| `e573747` | Repository, CI, build, hook, lint, and release foundations                        |
| `15e4b49` | Authoritative state protocol, SDK controller, durable Jobs, and Job-backed Swarms |
| `8ed0faa` | Electron process and IPC hardening                                                |
| `9fdb560` | Runtime initialization and cross-platform reliability fixes                       |

The committed branch is a linear descendant of `origin/main`, 26 commits ahead and 0 behind. The current worktree contains the next performance and client-cutover slice described below. The four committed recovery changes are reviewable boundaries, but the earlier ADE history still needs to be carved into an intentional PR sequence before integration.

Status terms used below:

- **Done**: implemented and covered by the current local quality gate.
- **In progress**: the target path exists, but a legacy path or acceptance gap remains.
- **Not started**: no production-capable implementation is present yet.

## Progress by workstream

### Repository and green baseline — Done

- The root `test:ci` pipeline verifies that every package with tests defines a CI test task, then runs the package suites through Turbo.
- GUI, JavaScript SDK, and LLM packages now expose `test:ci`; Opencode uses a deterministic runner that isolates known global-state and process-sensitive families.
- Linux and Windows unit CI run the root test gate, lint baseline, and Linux HTTP API exerciser coverage.
- Core tests isolate configuration and data directories from the developer's real home directory.
- Pre-commit checks staged files and whitespace without rewriting or auto-staging. Pre-push runs the fast affected-package gate.
- Correctness lint rules are errors. The existing warning count is recorded so it cannot increase, although the inherited warning backlog is not yet eliminated.
- Generated Graphify output, local interpreter paths, caches, and test artifacts are ignored rather than committed. `.graphifyignore` and the manual update command remain documented.

Last full local recovery validation:

- Typecheck: 13 of 13 tasks passed.
- Opencode tests: 3,197 passed, 64 skipped, 0 failed.
- Other package CI suites: 8 of 8 tasks passed.
- Lint: no correctness errors; the current slice reduces the warning count from the 2,736 baseline to 2,694.
- CI task coverage and `git diff --check`: passed.

These are local results, not evidence that every hosted CI or packaging matrix job has completed successfully.

Current uncommitted slice validation:

- GUI: 285 unit/functional tests, renderer/main/preload typechecks, and two real Chromium acceptance tests pass. The rendered workflow now covers authoritative bootstrap/idle behavior plus project/session setup, bounded Swarm creation, View creation, Workbench file/Git loading, command-palette navigation, Plugin Center navigation, keyboard help, and visible desktop-only action feedback.
- SDK: 27 CI tests and typecheck pass, including idle metrics, root/operations/capability refresh coalescing, sustained session-invalidation coalescing, live-event deduplication, retention reset, reconnect, domain-specific invalidation, and out-of-order part buffering.
- Opencode: typecheck, the 11-test TUI lifecycle/render/projection suite, and the authoritative-state HTTP/SSE integration test pass when run in their isolated families.
- Lint baseline and `git diff --check` pass.
- The former monolithic Opencode runner could spend more than ten minutes in one SQLite/global-service-heavy Bun process without phase output or a watchdog. The replacement emits 30-second named heartbeats, writes per-shard logs/JUnit directly through OS file descriptors, applies a 15-minute command watchdog, and isolates timing-sensitive families.
- Profiling showed snapshot, project, and file suites become 3-5x slower when run together. They now run serially before the process pool; isolated measurements are 107 seconds, 69 seconds, and 97 seconds respectively. Server tests complete in about 67 seconds across three process-isolated shards instead of 272 seconds in one area process.
- Successive full runs exposed and fixed a Bun 1.3.14 module-subpath resolution regression, TUI hydration error propagation, stale legacy state fixtures, domain-specific raw event invalidation, and an order-dependent websocket pool retry reset. The corrected SDK (20/20 focused controller tests), TUI sync (5/5 across the two focused files), websocket (72/72 over three repetitions), and isolated heavy suites pass.
- The complete Opencode `test:ci` gate now passes. The recorded run took 13:00 because 18 orphaned Git metadata children made the first snapshot phase take 304 seconds instead of its clean isolated 107 seconds. Follow-up isolation proved those `rev-parse HEAD` and `remote -v` children come from the workspace shell/status integration itself: after cleanup, a plain `Write-Output ok` call recreates the pair without running Bun or Opencode. The runner now makes any such environmental slowdown visible through named heartbeats and artifacts. Its clean measured phase estimate is about 9:44; a hosted clean-checkout timing is still needed as authoritative evidence.
- The `stats` command now skips full project/plugin/file/LSP instance bootstrap unless `--project ""` explicitly requests the current project. This removes unnecessary application startup work from the common all-project aggregation path.

### Server-authoritative state and SDK — In progress

Implemented:

- New namespaced endpoints expose a root snapshot, operations-only snapshot, capabilities snapshot, lazy session snapshot/paging, and replayable SSE stream under `/experimental/opencodex/state`.
- Snapshots carry scope, epoch, cursor, digest, domain revisions, catalog data, and operations data. Session transcript details remain lazy.
- State events classify capabilities, catalog, operations, and session invalidation; aggregate sequence gaps and epoch/scope mismatches trigger a reset.
- Retention is bounded to seven days or 100,000 events. A cursor below the retention floor receives `reset_required` instead of silently losing changes.
- Root hydration batches project, view, session, status, permission, question, Job, and Swarm reads. Project and view hydration share one global-session read instead of issuing duplicate 5,000-row catalog scans. Views now have a real `sort_order` column.
- Permission and question requests are indexed once by session during root projection instead of repeatedly filtering both arrays for every session.
- `ClientStateSync` owns bootstrap buffering, reconnect, cursor replay, 16 ms event batching, stale-request rejection, structural sharing, tombstones, loaded-session refresh, and older transcript-page reconciliation.
- Root refresh bursts are coalesced to one in-flight request and at most one trailing correction, avoiding parallel duplicate snapshot hydration while preserving a final authoritative read.
- Operations invalidations use the atomic `/experimental/opencodex/state/operations` snapshot and reconcile only Jobs and Swarms. They no longer download, hash, or reconcile projects, sessions, views, statuses, permissions, questions, or capabilities; focused transport metrics prove a raw Job transition performs one operations request and zero additional root requests.
- Snapshot revisions come from the scoped, transactionally committed state-event revision vector. Root and operations snapshots no longer serialize and hash their complete payloads merely to detect change; HTTP coverage proves a Job event advances only the operations revision while leaving the catalog revision stable.
- Loaded-session invalidations use a 500 ms trailing correction per session instead of fetching a full transcript snapshot for every 16 ms invalidation batch. Token deltas stay on the in-memory acceleration path, while clustered authoritative message/part/status changes produce one correction after the burst rather than repeated database/API hydration.
- The controller is the sole first-party reducer for session, status, permission, question, message, part, todo, and diff events. It deduplicates event IDs, buffers part deltas that arrive before their part, and exposes a per-session live revision to both adapters.
- The durable state bridge now records only capabilities, catalog, operations, and loaded-session-detail changes. LSP, MCP, and plugin changes invalidate capabilities; file watcher, terminal, installation, and unrelated events no longer masquerade as catalog invalidations.
- Nested message and part events resolve to their owning session aggregate, so a loaded transcript is authoritatively corrected after non-delta message changes.
- The state stream assigns one contiguous local sequence per scoped aggregate instead of mixing incompatible legacy and canonical counters; the HTTP replay test proves later session events advance exactly once.
- Shared selectors project the catalog and operations shapes consumed by both clients.
- `ClientStateSync` now owns a revisioned capabilities composite covering providers, provider defaults/connectivity, configuration, agents, commands, formatter, LSP, MCP status/resources, and plugins. The composite comes from one atomic `/experimental/opencodex/state/capabilities` snapshot, coalesces refresh bursts, preserves unchanged references, records metrics, and invalidates through both durable and live plugin/LSP/MCP events.
- SDK tests cover structural sharing, deletion, duplicate events, aggregate gaps, cursor ownership, operations invalidation, filtered catalog parity, authoritative part replacement, transcript paging, bootstrap buffering, and failed optimistic mutations.
- The cross-client contract matrix drives one controller through bootstrap, event-before-snapshot replay, duplicate live deltas, out-of-order parts, permission/question resolution, transcript paging, deletion/tombstones, reconnect, and retention reset, then compares the GUI and TUI adapters after each scenario.
- Raw OpencodeX project and view events invalidate catalog state, while Job and Swarm events invalidate operations state. Both paths are classified by the shared controller, so first-party adapters carry no local refresh switches.

Still incomplete:

- The matrix proves adapter parity for the required state transitions, but realistic large-catalog fixtures, query-count assertions, and render/CPU budgets are still missing.

### GUI and TUI state cutover — In progress

Implemented:

- Both clients instantiate the shared SDK controller and consume shared catalog and operations selectors.
- The previous GUI 500 ms session polling and five-second full-snapshot polling were removed.
- The TUI no longer periodically polls session state.
- The TUI no longer imports or calls the legacy `session-sync` endpoint. Bootstrap, manual refresh, status refresh, and session hydration all go through `ClientStateSync`.
- Raw upstream session events are consumed by the shared controller as an ephemeral acceleration path; durable state invalidations provide bounded trailing correction.
- The GUI now ignores unrelated global events instead of treating every unknown event as a reason to reload sessions, providers, configuration, MCP, LSP, plugins, Jobs, and Swarms.
- The GUI no longer imports or calls legacy session-sync helpers. Startup loads authoritative root state and capabilities in parallel, all application transcript hydration/paging goes through `ClientStateSync`, and the browser smoke fails on any compatibility-endpoint request.
- GUI and TUI core capabilities now use the shared controller loader, revision, selector, and reference-preserving adapters. MCP, LSP, and plugin events refresh only capabilities; instance disposal refreshes both capabilities and root state.
- The client-state boundary check rejects direct root/session reducers, legacy sync calls, and direct first-party provider/config/agent/command/LSP/MCP bootstrap loaders.
- GUI and TUI no longer contain independent reducers for session/catalog/status/interaction/transcript events. Both project the same controller state and use epoch-qualified live revisions for loaded transcript updates.
- The TUI state-to-store projection is now a pure, independently tested adapter rather than being embedded in the Solid context reducer.
- TUI directory filtering is a derived projection over the canonical project catalog. Toggling it reprojects controller state and no longer changes the server synchronization contract.
- TUI session hydration errors are nonfatal and remain retryable instead of rejecting the route transition or marking a failed hydration complete.
- Workbench assistant transcript hydration is injected from the shared controller rather than calling the direct session loader.
- Loaded transcript snapshots are reconciled without blindly replacing every message and part object.
- Existing centralized GUI transcript-scroll policy remains unchanged.

Still incomplete:

- The GUI still maintains presentation caches for selected and multi-pane sessions. They now have one state input, but their ownership and eviction policy should move into a dedicated session controller.
- The compatibility endpoint is unused by first-party clients and documented as deprecated for the `0.0.1` window, with removal scheduled for `0.0.2` or later. Its SDK helper is quarantined in `@opencode-ai/sdk/v2/legacy-session-sync`.
- Connectivity state, backoff, retry, older-page loading, and controller errors are not exposed through one complete client-facing lifecycle API.

The next state milestone is adding realistic snapshot/query/render performance budgets, followed by extraction of the remaining presentation caches from the GUI application shell.

### Durable Jobs — In progress

Implemented:

- Persisted lifecycle: `queued -> claimed -> running -> succeeded|failed|cancelled|interrupted`.
- Persisted idempotency key, attempt/max attempts, lease owner/expiry, session, parent Job, Swarm/role references, timeouts, timestamps, result, structured failure, and metadata.
- Compare-and-set transition updates reject concurrent status changes and illegal transitions.
- Claim, start, renew, succeed, fail, retry, cancel, and expired-lease recovery operations are available through the service and generated API.
- Tests cover idempotent submission, the legal lifecycle, illegal transitions, lease ownership, expired-lease interruption, bounded retry, and idempotent cancellation.
- Job mutations, canonical sync events, and client-visible durable invalidations now share one enclosing database transaction. Event broadcast happens only after commit, and rollback coverage proves the event row cannot survive a failed mutation.
- A startup-scoped dispatcher claims registered queued Jobs, heartbeats leases, enforces persisted timeouts, propagates cancellation, retries within `maxAttempts`, recovers expired work, and leaves no terminal Job with a live lease.
- The dispatcher enforces parent dependencies: children remain queued until their parent succeeds and are cancelled when the parent fails, is cancelled, or is interrupted.
- Dispatcher jobs can be persisted with `dispatchReady: false` while their linked graph is committed, preventing a newly emitted Job event from racing incomplete Swarm rows. Enabling dispatch is an explicit persisted transition after graph construction.
- Focused runtime tests cover success, retry, timeout, cancellation, successful dependency release, and failed-parent cancellation.

Still incomplete:

- Cancellation records intent, but there is no single runtime contract that proves the associated process/session is terminated before terminal state is committed.
- Dispatcher recovery is implemented, but application restart is not yet exercised with a real interrupted executor and reconstructed Swarm graph.
- Claim contention, cancellation-versus-completion, lease-renewal-versus-expiry, and concurrent cross-process idempotency races still need dedicated tests.
- Only registered Job kinds execute. Manual and future automation kinds need explicit executor contracts rather than a catch-all runner.

### Swarms — In progress and experimental

Implemented:

- Orchestrator and specialist roles create linked `swarm.orchestrator`, `swarm.worker`, and `swarm.synthesis` Jobs with stable parent, run, role, and Swarm references.
- Orchestrator, worker, and synthesis executors are all registered with the durable dispatcher; no phase manually claims, starts, succeeds, or fails its own Job.
- The Swarm service is the canonical creation and lifecycle boundary; the tool delegates to it instead of writing tables directly.
- Swarm/run/role records use transactions for several multi-table updates.
- Cancellation propagates to related sessions and Jobs, and aggregate completion is reconciled from terminal Job state.
- TUI and GUI surfaces can create, inspect, assign, cancel, and delete Swarms through namespaced experimental routes.
- A real HTTP/SDK integration test drives an orchestrator, one worker, and synthesis through a fake LLM and proves all three Jobs succeed and the aggregate Swarm completes.

Still incomplete:

- Startup reconciliation no longer fails healthy queued Swarms before dispatcher handlers register, but a real application restart during each phase still needs end-to-end coverage.
- Dispatcher recovery deterministically interrupts or retries expired Jobs, but Swarm sessions are not yet resumable without a duplicate prompt at every interruption point.
- Failure/cancellation updates span Job, Swarm run, role, agent-run, session, and event writes without one atomic recovery protocol.
- The automation suite does not yet cover partial worker failure, synthesis after mixed results, restart during each phase, cancellation races, or the invariant that no running record exists without a live lease.

### Desktop security — Substantially done

- Renderer and embedded-browser views use context isolation and sandboxing.
- Terminal and browser IPC resources are owned by the creating renderer; writes, resizes, navigation, and destruction validate that owner.
- Browser permissions and downloads are denied by default, popup behavior is constrained, and the embedded browser uses a separate persistent partition.
- Editor commands are parsed into executable and arguments and launched without a shell.
- Focused tests cover editor command parsing.

Remaining security work:

- Add automated hostile-input coverage for every IPC channel, external URL scheme, authorization-header origin, popup path, and editor/configuration payload.
- Run a real packaged desktop security smoke test, not only unit-level checks.
- Document the trusted-local-workspace boundary and the residual authority granted to terminal/editor features.

### Client structure and performance — Not complete

The architecture is still expensive to reason about and likely contributes to runtime regressions:

- GUI `app.tsx` is about 3,500 lines and owns routing, synchronization, session caches, navigation, mutations, workbench state, and page composition.
- The GUI session side panel is about 2,400 lines.
- The TUI operations component is about 3,400 lines; the Swarm service is about 1,850 lines.
- GUI styles remain 23 numeric sections, making cascade ownership and dead-rule removal difficult.
- Some surfaces still run independent timers, including status spinners; the periodic Workbench file/Git refresh loop has been removed.
- No repeatable profile currently records idle CPU, event-to-paint time, snapshot latency/size, query groups, render counts, or memory growth.

Initial test and performance infrastructure now implemented:

- The SDK state controller exposes deterministic request, stream, batch, reconnect, reset, commit, live-event, duplicate-event, session-invalidation, and coalesced-correction counters.
- A Playwright Chromium smoke launches a real isolated backend and renderer, navigates the rendered GUI, records browser failures, captures artifacts, and enforces the idle no-snapshot-poll invariant.
- The full TUI dashboard is rendered with OpenTUI's test renderer and enforces the same idle invariant.
- Hosted CI has a dedicated Chromium job and retains its screenshot, trace, video, and JUnit evidence.
- The real-browser and TUI harnesses both assert that idle clients do not issue periodic root, capability, or legacy snapshot requests.
- Focused regression tests prove file watcher events do not trigger GUI full refreshes, root refresh bursts are coalesced, and sustained session invalidations cause one trailing correction instead of repeated transcript hydration.
- Focused regression tests prove Job and Swarm invalidations issue operations-only corrections, and root hydration reuses one global session catalog across project and view projections.
- GUI and TUI decorative logo clocks were reduced from 60 Hz to 20 Hz. Hidden session empty-state logos, background/unfocused GUI windows, reduced-motion browsers, and TUI routes with animations disabled perform no logo clock work.
- The real Chromium smoke explicitly emulates reduced motion and enforces zero logo subtree mutations over its idle probe, in addition to the no-state-poll invariant.
- Opening Workbench no longer starts the repository's full typecheck automatically. Diagnostics are an explicit `Run project checks` action, and file/Git synchronization occurs on route entry, tab activation, focus, mutation, or manual action rather than every 4.5 seconds.
- The Swarm editor no longer renders every catalog model into every role. It separates provider and model selection, limits inline providers to connected, built-in, or previously selected providers, and preserves unavailable saved choices. The real-browser gate caps the complete two-role editor below 100 option nodes; the verified fixture dropped from thousands of options per role to 43 total options after adding the second role.
- Application actions now surface success, unavailable-feature, and failure feedback in a dismissible accessible notification instead of writing only to the developer console. Escape dismisses it when Escape is not reserved for aborting an active session.
- Titlebar Cut/Copy/Paste now use an Electron-owned edit IPC path in the desktop runtime, with the browser command fallback retained for renderer development. Command palette and keyboard-help overlays expose dialog semantics.
- A real Electron acceptance suite now exercises the compiled sandboxed preload, folder/context pickers, titlebar edit/window controls, an exact Workbench file save, stage/commit in a disposable repository, embedded-browser bounds/screenshot/navigation, a real PTY command, and shutdown. It completes in about 65-70 seconds on the current Windows workstation.
- The acceptance suite found and fixed a desktop startup failure: the sandboxed preload had been emitted as ESM and never exposed `window.opencodex`. The preload now emits and loads as CommonJS (`index.cjs`) while sandboxing remains enabled.
- Workbench now reads exact text through a namespaced endpoint before optimistic writes. The generic upstream file API trims content, which previously made ordinary trailing-newline files permanently conflict on Save.
- Embedded browser tabs now start blank instead of implicitly loading `localhost:5173`; this prevents unrelated local development applications from consuming resources or intercepting the Workbench surface.
- GUI route splitting reduced the dashboard entry JavaScript from about 2.686 MB / 808.8 KB gzip to 876.8 KB / 250.6 KB gzip. Session, workspace tools, Workbench, Views, Swarms, Plugins, and Diff load at their domain boundaries; workspace tools remain mounted after first use.
- The rendered acceptance workflow and current limitations are tracked in `docs/gui-control-acceptance.md`.

Required next step:

1. Add instrumentation and realistic fixtures before optimizing: idle request count, CPU samples, event throughput, snapshot size/latency, Solid render counts, and transcript memory.
2. Extend the shared bootstrap/replay/reset/live-event matrix with realistic large-catalog fixtures so profiling and later client decomposition retain behavioral parity.
3. Continue splitting GUI application shell, navigation, session, capabilities, and operations controllers; the first route-level bundle boundaries are now in place.
4. Split TUI operations into route-level Jobs, Swarms, Teams, and Views modules, keeping presentation local to each client.
5. Replace numeric CSS sections with named token, base, shell, session, workbench, operations, and overlay layers.
6. Bound or virtualize large Workbench change/history lists and profile connected providers with unusually large model catalogs.

Do not change the transcript-scroll contract during this work: near-bottom following remains 200 px, user input suppresses follow for the existing release window, and Load More preserves its clicked viewport anchor.

### Builds and releases — In progress

Implemented:

- Dependency installs use the frozen lockfile in CI and release builds.
- Build targets are validated against allowlists and fail when no supported target is selected.
- Model metadata is generated from a pinned local snapshot with SHA-256 verification; network refresh is an explicit maintenance command.
- Legacy scripts that publish to upstream registries/channels require `OPENCODEX_ENABLE_LEGACY_PUBLISH=1`.
- GitHub Actions are pinned by immutable SHA.
- CLI and GUI release workflows run quality gates, enforce aligned versions, generate checksums, validate signing inputs, and define packaged smoke jobs for Linux, Windows, and macOS.

Still incomplete:

- Prove the release from a clean checkout on every target and retain evidence for install, sidecar startup, client startup, authentication, health, session open, reconnect, and shutdown.
- Require an approved release commit or version-aligned tag as policy, rather than relying only on manual workflow discipline.
- Verify produced Windows signatures and macOS signing/notarization after artifact creation.
- Remove or physically quarantine obsolete upstream publishing code after the compatibility window, rather than only guarding it with an environment variable.

## Recommended execution order

### 1. Finish state authority and establish performance evidence

- Keep catalog, operations, and capabilities independently refreshable; capabilities and operations now have atomic domain snapshots, while catalog remains the root bootstrap/correction payload.
- Index session permissions/questions once per root snapshot and benchmark realistic catalogs.
- Add request, snapshot, reconciliation, render, and idle-CPU instrumentation.
- Keep the shared state-contract matrix running through SDK, GUI adapter, and TUI adapter tests as new state domains are added.
- Retain legacy session-sync only as a documented compatibility shim and enforce the first-party boundary in CI.

Exit gate: an idle connected client performs no periodic state request; operations events never reload catalog/capabilities; both clients reach equivalent state for the complete fixture matrix.

### 2. Add a real durable Job runtime

- Extend the transactional EventV2 commit/broadcast boundary to every remaining automation aggregate mutation.
- Harden the startup-owned dispatcher with claim-contention, cancellation race, lease-expiry, and real restart tests.
- Define executor adapters for session/agent work and process termination; keep Job state independent of the HTTP request lifetime.
- Move orchestrator and synthesis execution onto the dispatcher so the entire Swarm is an enqueued graph rather than a request-owned fiber.

Exit gate: restart and race tests pass, and no `claimed` or `running` record can persist without a recoverable live lease.

### 3. Decompose and optimize the clients

- Split controllers and route modules along the domain boundaries above.
- Profile first, then eliminate unnecessary signal fanout, repeated full-array scans, hidden animation loops, and independent refresh timers.
- Add GUI component/visual coverage and TUI render fixtures for equivalent major states.

Exit gate: performance budgets pass on a realistic large workspace and client behavior remains parity-tested.

### 4. Close security and release gates

- Complete hostile IPC/origin/configuration tests and the packaged desktop sidecar smoke.
- Run the full signed cross-platform release from a clean checkout and verify installed artifacts.
- Keep Jobs/Swarms experimental until both the automation and release gates pass.

### 5. Deliver as reviewable PRs

Carve the branch into ordered PRs against `main`: repository foundation; state service/SDK; paired TUI/GUI adapters; client restructuring/performance; durable Job runtime; Swarm execution; desktop/release hardening. Avoid broad formatting or inherited upstream cleanup in functional PRs.

## Graphify note

The local Graphify graph correctly points to the large GUI/TUI synchronization and operations surfaces, but it predates part of the recovery work and produced noisy results for this status review. This document treats the current source, committed diff, generated SDK, and tests as authoritative. Rebuild Graphify after the branch is carved into stable commits; do not commit its generated output.
