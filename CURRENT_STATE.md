# OpencodeX — Current State Audit

**Date:** 2026-07-28
**Scope:** Full-repository audit for handoff — every package and top-level directory was examined by eight parallel deep-dive reviews (TUI, backend/core, GUI, GUI↔TUI parity, performance, fork cruft, build/CI/docs/testing, supporting packages), then cross-checked and synthesized here.
**Method note:** All file:line references were verified at audit time against commit `416f1e91d5`. Severity tags: 🔴 Critical, 🟠 High, 🟡 Medium, ⚪ Low.

---

> ## ⚠️ ADDENDUM — cleanup branch landed (2026-07-29)
>
> **The body of this document below describes the repository as of 2026-07-28, before the cleanup
> branch built from it.** It has deliberately not been rewritten — it is the record the work was
> planned against. Read this addendum first; where the two disagree, this addendum wins.
>
> ### Resolved by the cleanup branch
>
> | Audit finding | Resolution |
> |---|---|
> | §1.1 unbounded, unindexed `event` table | `packages/core/src/event/retention.ts` compacts the journal on a 60s loop (first + last revision per entity); `event_aggregate_seq_idx` added by migration `20260728232403_cooing_arachne`; replay relaxed from dense to strictly-increasing sequences. |
> | §1.1 every shell stdout chunk becomes a durable transaction | `Session.updatePart` gained a `transient` mode for in-flight progress, and `ctx.metadata` is coalesced per tool call on a 100 ms leading+trailing window. Terminal tool state stays durable. |
> | §1.1 TUI hydrates entire transcripts | TUI transcript paging, eviction, and windowing; SDK parts keyed by message with a dedupe ring. |
> | §1.2 ~76% of `packages/ui` dead | Pruned. What survives is exactly the components the GUI imports plus the five notification `.mp3`s the TUI imports. |
> | §1.2 deletable packages/scripts | `packages/{containers,identity,extensions,effect-sqlite-node}`, `script/{publish.ts,release,generate.ts}`, `.husky/graphify-update` and dead in-tree modules removed; the `upstream/policy.json` prune-path bug that let them pass `surface:audit` is fixed. |
> | §1.2 session data flowing to upstream infrastructure | Share pipeline (`opncd.ai`), the `app.opencode.ai` web-UI proxy and `web` command, and console/account login are all deleted, with migrations dropping `session_share`, `session.share_url`, `account`, `account_state`, and `control_account`. |
> | §1.3 parity drift ring of hand-duplicated modules | Normalizer, display text, and status logic unified into the SDK; the GUI's dead second reducer deleted; a coordinator version handshake plus three GUI parity features added. |
> | §1.4 v2 message/event system half-migrated | The experimental v2 system is deleted outright, along with the legacy session-sync endpoint and its compatibility gate. |
> | §4 `cmd/run` as a second interactive TUI | `run --interactive` and the whole `cli/cmd/run/` split-footer surface deleted. Non-interactive `opencode run` is unaffected. |
> | §4 PTY HTTP surface, `tui/appendPrompt` | Removed. |
> | §"Fork identity / branding" items (TUI crash-report URL at upstream's repo, `SECURITY.md` escalation address at `security@anoma.ly`, terminal titles, upstream docker-image tip, upstream `$schema` URLs, release version fetched from upstream's npm package) | All fixed. |
>
> Migration count is now **44** (the audit's table says 40). `docs/UPSTREAM.md` now carries a
> **divergence ledger** recording every upstream-owned path this branch deleted, moved, or split, so
> the first sync treats them as deliberate.
>
> ### Post-implementation review pass (same day)
>
> A five-way adversarial review of the branch (dangling references, backend correctness, client
> parity, structural fidelity, plan-vs-implementation) confirmed the work and produced one more
> round of fixes:
>
> - **Dead surface the deletions left behind, now removed:** the v2 `/api` auth/routing plumbing
>   still wired into the live server (`V2Authorization`, `isV2ApiPath`, the `/api/` workspace-routing
>   branch); the frozen legacy SDK's `Pty` class, `share`/`unshare`, `appendPrompt`, and their
>   types/config keys (all 404 server-side); ~1,200 lines of scrollback rendering in `cmd/run/tool.ts`
>   that only the deleted interactive renderer used; the GUI's `session.next.*` classifier arm; stale
>   `sharedSeams` entries in `upstream/policy.json`.
> - **Logic gaps closed:** the GUI attention-notification gate now keys on `phase === "ready"` (was
>   announcing every outstanding item after bootstrap/reset); the streaming-part predicate is
>   unified behind one SDK helper (`isStreamingClientPart`) instead of three drifting forms; a
>   prepend page can no longer tombstone live parts of an already-resident message; the metadata
>   coalescer got a sequence guard against a permit-race reordering; the retention and status
>   maintenance loops survive a failed pass instead of dying silently; the TUI releases warm SDK
>   tails on reset.
> - **Added:** an `OPENCODE_SKIP_MIGRATIONS` regression test; lint baseline ratcheted 2630 → 2319
>   (the exact Linux/CI count — oxlint reports ~33 fewer warnings on Windows, so local runs show slack).
> - **Kept deliberately:** the SDK `./v2/server` export (`v2/index.ts` re-exports it, so it was
>   never consumer-less as the plan claimed).
>
> ### Corrections to this audit
>
> Two "dead code" findings in §3 were wrong. Both are live:
>
> - **`/sync/steal` is live.** It is called by `packages/opencode/src/control-plane/workspace.ts:793` during session warp, when a session is moved into a workspace owned by another coordinator. It was kept.
> - **`storage/json-migration.ts` is live.** It is wired into all three entry points — `packages/opencode/src/index.ts:34`, `src/gui-coordinator-runtime.ts:7`, and re-exported from `src/node.ts:6`. It performs the one-time JSON→SQLite import and cannot be removed while any pre-SQLite install exists. It was kept.
>
> ### Still open after this branch
>
> - **The upstream sync has still not been executed.** The pin remains `v1.15.13` (2026-05-31) against `v1.18.3` observed 2026-07-18 — three minor versions — and the history is still a snapshot import without a common ancestor, so the first sync is an unrelated-histories merge whose conflict surface keeps growing. This is now the single largest unaddressed risk in the repo.
> - **Native LLM path is still gated to 3 of 11 provider adapters.** `packages/opencode/src/session/llm/native-runtime.ts` still admits only `openai`, `anthropic`, and `opencode*`; Azure/Google/Bedrock/OpenRouter remain wired but blocked.
> - **macOS has no CI.** `.github/workflows/ci.yml` runs `ubuntu-latest` and `windows-latest` only, while `release-cli.yml` ships `darwin-arm64` and `darwin-x64` assets. Those binaries are released untested.
> - **~2,300 lint warnings remain**, baselined rather than fixed. The ceiling in `.oxlint-baseline.json` is ratcheted to the exact current count on Linux, where CI runs (2,319, down from main's 2,630), so any new warning fails CI — but the debt itself is untouched. Note the count is platform-dependent: Windows reports ~33 fewer, so local runs carry that much slack.
> - **The plugin API is still typed against the v1 SDK frozen at fork inception** (§1.4's second half-finished migration) — untouched by this branch.
> - Four of the five `BACKEND_SYNC_PROGRESS.md` "Residual architecture follow-ups" remain open (filesystem→event outbox, plugin multi-write journal, one-authority-per-database below the launch paths, process-level restart/soak test). Only the event-journal item was resolved.

---

## 1. Executive summary

OpencodeX is a two-month-old, single-author fork of [opencode](https://github.com/anomalyco/opencode) (85 commits, 2026-05-31 → 2026-07-28) that adds a multi-session workspace layer: a persistent sidebar/dashboard TUI, an Electron GUI, projects, views, swarms, and a durable-state SQLite backend shared by both clients. The engineering quality of the *fork-authored* code is unusually high — near-zero TODOs, almost no `any`, hardened Electron security, disciplined migration/event machinery, real parity tests, and serious CI. The problems cluster in four areas:

1. **Performance (worst area).** Three critical defects on the hot path: (a) every shell stdout chunk becomes a durable, write-locking SQLite transaction appending up to ~30 KB of JSON to an append-only `event` table; (b) that table has **no retention and no index on its query column** — it grows forever and its reads/deletes are full scans; (c) the TUI hydrates **entire session transcripts** into memory with no eviction and no virtualization, making long sessions O(n) to open and GC-bound while streaming.
2. **Dead code and fork cruft.** ~76% of `packages/ui` (~19k LOC, upstream web-frontend residue) is unreachable but kept green by its own tests. Six package directories, one workspace package, several dependencies, and multiple scripts are deletable. More seriously, **session data still flows to upstream's hosted infrastructure by default** (share → `opncd.ai`, web UI proxy → `app.opencode.ai`, console login → `console.opencode.ai`), contradicting the ROADMAP's own support policy.
3. **Parity drift at the edges.** The shared SDK state-sync engine gives genuinely strong GUI↔TUI parity by construction, but a ring of ~8 hand-duplicated modules has already diverged in user-visible ways: the same session can display "running" in the TUI and "dormant" in the GUI, and the same stored message renders as clean prose in the GUI but raw JSON in the TUI.
4. **Two half-finished migrations.** The v2 message/event system (dual-writes behind a default-off flag; the production model is confusingly named `SessionLegacy`) and the plugin API (typed against a v1 SDK frozen at fork inception while the server contract has moved on).

The upstream pin is 3 minor versions behind with the first real sync not yet attempted, and because history was imported without a common ancestor, every future sync is an unrelated-histories merge whose conflict surface grows with delay.

---

## 2. Repository overview

### 2.1 Stats

| Metric | Value |
|---|---|
| Tracked files | ~2,879 |
| TypeScript/TSX | ~416k lines (≈30k generated SDK, large test corpus) |
| CSS | ~34.5k lines (GUI ~20.7k across 98 files; packages/ui ~13.7k) |
| Commits | 85, single author, 2026-05-31 → 2026-07-28 |
| Upstream pin | `anomalyco/opencode` v1.15.13 (2026-05-31); upstream latest observed v1.18.3 (2026-07-18) |
| History mode | Snapshot import **without common ancestor** (`upstream/lock.json`) |
| Test files | 497 (opencode 301, gui 97+18 E2E, core 58, llm 26, ui 8, sdk 4, others 3) |
| DB migrations | 40 (TypeScript-driven, journaled; `BACKEND_SYNC_PROGRESS.md` stale at "37") |
| Patched dependencies | 8 (`patches/`) |
| Baselined lint warnings | 2,630 (`.oxlint-baseline.json`) |

### 2.2 Package map

| Package | Size (approx.) | Role | Health verdict |
|---|---|---|---|
| `packages/opencode` | ~61k LOC `src/cli` + ~74k `src` non-CLI | The product: TUI (`cli/cmd/tui`, 36k), second interactive surface (`cli/cmd/run`, 16.8k), CLI subcommands, HTTP server, `opencodex/` domain layer (11k) | Core is solid; carries most perf debt and fork cruft |
| `packages/core` | ~18k LOC src | Shared kernel: SQLite layer, migrations, EventV2 bus/journal, v2 session projector, vendored `github-copilot/` | Solid; unbounded `event` table is the standout defect |
| `packages/gui` | ~40k LOC TS + ~20.7k CSS | Solid.js Electron GUI, sidecar coordinator protocol | Cleanest large package; CSS organization and 4-layer session cache are the liabilities |
| `packages/sdk` | ~35k LOC (87% generated) | Typed client + shared `client-sync` state engine (~3.3k hand-written) | v2 gen in sync with server; v1 gen frozen at fork inception (plugin API depends on it) |
| `packages/ui` | ~25k LOC TS + 13.7k CSS | Upstream web component library | **~76% dead** — only ~32 modules reachable (GUI imports + 4 TUI audio files) |
| `packages/llm` | ~8.7k LOC src | Native LLM core (Effect-Schema, protocol adapters, 11 providers) | Healthiest large package; only 3 of 11 providers product-reachable behind experimental flag |
| `packages/plugin` | 1.2k LOC | Public plugin API types | Keep; typed against frozen v1 SDK — needs v2 migration |
| `packages/effect-drizzle-sqlite` | 3.2k LOC | Vendored Drizzle↔Effect adapter (production DB layer) | Keep (vendored deliberately; don't hold to house style) |
| `packages/http-recorder` | 0.9k LOC | Record/replay test infra with secret redaction | Keep |
| `packages/script` | 70 LOC | Release/version helper | Keep but rewrite (fetches **upstream's** npm package to compute versions) |
| `packages/effect-sqlite-node` | 168 LOC | Node SQLite Effect client | **Delete** — zero imports; superseded by in-tree copy in core |
| `packages/containers` | 77 LOC + 5 Dockerfiles | CI image builds targeting `ghcr.io/anomalyco` (upstream org) | **Delete** |
| `packages/identity` / `extensions` / `slack` / `cli` | ~0 | Upstream residue (logos, Zed extension, empty dirs) | **Delete** |
| `github/` | small workspace | The published GitHub Action (rebranded to `ecgreen/OpencodeX`) | Keep; OIDC/share defaults still point at upstream infra |

### 2.3 Architecture in one paragraph

A single **coordinator** process per SQLite database owns all writes (single-backend-authority model). Every mutation follows *EventV2 barrier → immediate SQLite transaction → durable rows + event-journal row → in-memory broadcast* ([event.ts:259](packages/core/src/event.ts:259)). Clients (TUI, GUI sidecar, SDK consumers) attach over HTTP+SSE: a transient `/global/event` stream for low-latency notifications and a durable `/experimental/opencodex/state/event` stream with cursor replay, epoch reset, and bounded replay (512 events). Both front ends consume the **same** SDK state engine (`createClientStateSync`, `packages/sdk/js/src/v2/`) and mutate through the same REST surface. Coordinator discovery is file-based: manifest JSON + 2s-heartbeat lease files under the state dir, guarded by locks and health probes; the GUI can attach to a TUI-started coordinator and vice versa. Session execution uses 15s leases with a 200ms-poll supervisor; prompt submission is idempotent via CAS command claims and a unique `(session_id, message_id)` index.

---

## 3. GUI ↔ TUI compatibility & parity

**Verdict: parity-by-construction for state and mutations is genuinely strong — better than most dual-client codebases — but a ring of ~8 hand-duplicated edge modules is where drift lives, and three of them already differ in user-visible ways.**

### 3.1 What is shared (and machine-checked)

- One sync engine: `createClientStateSync` owns event reducers, delta coalescing, out-of-order buffering, dedupe, cursor replay/epoch reset, correction backoff. TUI consumes it at [sync.tsx:424](packages/opencode/src/cli/cmd/tui/context/sync.tsx:424); GUI at [authoritative-state-controller.ts:304](packages/gui/src/renderer/src/controllers/authoritative-state-controller.ts:304). Both use the same SDK selectors and endpoints.
- Cross-client contract test: [state-contract.parity.test.ts](packages/gui/test/state-contract.parity.test.ts) imports the TUI's projection into the GUI suite and asserts identical output from identical event streams. [store.parity.test.ts](packages/gui/test/store.parity.test.ts) asserts endpoint/payload parity including the exact `msg_` client-ID format.
- Guard scripts: `script/check-legacy-session-sync.ts` bans the deprecated sync endpoint from both trees; `script/check-client-state-boundary.ts` bans hand-written reducers in the two hub files.

### 3.2 Known user-visible divergence (fix candidates, all 🟠/🟡)

| Divergence | Detail | Where |
|---|---|---|
| 🟠 Session status disagreement | Display-status derivation is **triplicated** (SDK, GUI, TUI). TUI adds `session_pending_prompt` optimism + an activity heuristic; GUI has neither — an incomplete assistant turn shows "running" in TUI, "dormant" in GUI. GUI also declares a `"failed"` status never produced. | [session-status.ts:12](packages/gui/src/renderer/src/lib/session-status.ts:12) vs [opencodex-session-status-core.ts:7](packages/opencode/src/cli/cmd/tui/component/opencodex-session-status-core.ts:7) |
| 🟡 Message text rendering | GUI strips system-reminder blocks and unwraps harmony/JSON envelopes; TUI has no equivalent — same stored message renders clean in GUI, raw JSON in TUI. | [message-text.ts:6](packages/gui/src/renderer/src/lib/message-text.ts:6) |
| 🟡 Plan-mode auto-switch | Agent auto-switch on `plan_enter`/`plan_exit` is TUI-only. | [session-controller.tsx:157](packages/opencode/src/cli/cmd/tui/routes/session/session-controller.tsx:157) |
| 🟡 OS notifications | Question/permission/done/error notifications + sounds are TUI-only; a backgrounded GUI gives no signal. | [notifications.ts:35](packages/opencode/src/cli/cmd/tui/feature-plugins/system/notifications.ts:35) |
| 🟡 Self-update | `installation.update-available` drives a TUI update flow; GUI neither handles the event nor ships an autoUpdater. | [app-events.ts:29](packages/opencode/src/cli/cmd/tui/app-events.ts:29) |
| ⚪ Pins don't sync | Pins/sidebar layout are client-local on both sides (TUI `session.json`, GUI localStorage); same coordinator shows different pins per client. | — |
| ⚪ Reconnect asymmetry | On SSE reconnect the TUI re-tails every synced session; the GUI does no correction (relies on durable stream). Different staleness windows; transient-only events lost by GUI are never recovered. | [sync.tsx:544](packages/opencode/src/cli/cmd/tui/context/sync.tsx:544) |
| ⚪ File-event watching | GUI refreshes git panel on `file.watcher.updated`; TUI footer follows `vcs.branch.updated`; each client watches a different event. | — |

### 3.3 Duplicated-by-hand modules (drift risk even where behavior currently matches)

Envelope normalizer (incl. the `\.\d+$` version-suffix strip), the `/global/event` SSE loop + backoff, the 2,000-entry dedupe ring, the 16ms batcher, the state-change detector, the transcript exporter, two same-named-but-different `isLikelyActiveSession` heuristics, and the **coordinator manifest protocol implemented twice** (GUI main process at [sidecar.ts:168](packages/gui/src/main/sidecar.ts:168), TUI at [coordinator-registry.ts:15](packages/opencode/src/cli/cmd/tui/coordinator-registry.ts:15)).

- 🟠 **No server-version handshake.** A GUI with bundled sidecar version A silently attaches to a TUI-started coordinator of version B; the only guards are manifest schema number, DB identity, and a health bool. SDK-vs-server skew (new event names, changed snapshot shapes) is unvalidated. Add server version to the manifest and `/global/health`, enforce a compatibility range in both attachers.
- 🟠 **A complete second reducer implementation survives in the GUI** ([live-session-patch.ts:230](packages/gui/src/renderer/src/lib/live-session-patch.ts:230) + helpers, ~500 LOC) — unused in production but exported, tested, and guarded against exactly one file. Delete the dead patchers or extend the boundary check to the whole tree.
- 🟡 Both boundary guard scripts are raw substring checks scoped to two files/four tokens — trivially bypassed by renames or imports elsewhere. No TUI-side parity test exists in `packages/opencode` (the cross-check lives only in the GUI suite).

### 3.4 Feature parity matrix (condensed)

Full parity on: session lifecycle (create/resume/rename/delete/move/fork/compact/abort/undo-redo/timeline), projects/folders, sidebar/rail taxonomy, dashboard + attention queue, command palette, slash commands (~40 vs ~45, tracked in `packages/gui/SLASH_COMMAND_PARITY.md`), model/variant/agent pickers (incl. swarm-as-model), provider connect, MCP management, permission/question prompts, diff viewer + reviewed-state (server-synced), views (focus server-synced), swarms, status page.

Intentionally divergent platform surfaces — **GUI-only:** file explorer/editor (CodeMirror+LSP), git panel, integrated terminals, embedded browser, GUI bridge, Claude Code terminal hosting, security settings page. **TUI-only:** ~200 rebindable keybinds/leader/which-key, 30-theme system (GUI has 2), remote `attach`, coordinator ownership, OS notifications, self-update.

Gaps flagged in both directions: GUI `/workspaces` and `/warp` are partial (documented follow-ups); TUI renders Claude Code terminal members but can't host the PTY; **jobs have data plumbing in both clients but a UI in neither**.

---

## 4. Performance

**Posture:** client-side pipelines are carefully engineered (16ms batching, delta coalescing, identity-preserving updates, GUI 128-message windowing, markdown LRU + morphdom). The critical debt is on the backend write path and the TUI data model.

### 4.1 Critical

- 🔴 **A durable SQLite transaction per shell stdout chunk.** [shell.ts:524](packages/opencode/src/tool/shell.ts:524) calls `ctx.metadata(...)` per output chunk (preview capped at 30,000 chars) → `updatePart` → sync-event persistence, which opens an **immediate transaction** and INSERTs the full part JSON into the append-only `event` table ([event.ts:229](packages/core/src/event.ts:229)). A chatty build = hundreds of write transactions/sec and tens of MB of permanent rows for one command, serialized against every other session on the single writer. Fix: throttle/coalesce metadata updates (≥100ms) and/or make transient `running`-state part updates broadcast-only (as `message.part.delta` already is).
- 🔴 **Unbounded, unindexed `event` table.** Every revision of every part/message is stored forever; nothing prunes it (`EventV2.remove` only fires on session deletion), and there is **no index on `aggregate_id`** ([event/sql.ts:10](packages/core/src/event/sql.ts:10)) — session-warp reads, deletion, and FK cascades are full scans over an ever-growing table. Contrast: `opencodex_state_event` has proper 7-day/100k retention. Fix: add `(aggregate_id, seq)` index; add retention/compaction (drop superseded part revisions on message completion).
- 🔴 **TUI hydrates entire transcripts, never evicts, renders unvirtualized.** Opening a session pages in **all** history ([sync.tsx:679](packages/opencode/src/cli/cmd/tui/context/sync.tsx:679)); `fullSyncedSessions` never shrinks; the transcript is a plain `<For>` mounting every message. Consequences compound: each applied delta spreads the entire `detail.parts` record ([client-sync-events.ts:324](packages/sdk/js/src/v2/client-sync-events.ts:324)) — O(total parts) copies 60×/sec while streaming a huge session — and reconnects re-tail *every* visited session. Fix: page like the GUI (tail window + load-more), release details on route leave, window/virtualize the `<For>`.

### 4.2 High / Medium (selected)

- 🟠 Session summarizer reloads the **entire transcript** from SQLite after every LLM step ([summary.ts:117](packages/opencode/src/session/summary.ts:117)) — ~200 queries + full decode per step on a 5k-message session, then re-publishes another durable event with embedded patch text. Query the target message + children by indexed `parentID` instead.
- 🟠 All SQLite access is synchronous on the server event loop behind one semaphore ([sqlite.bun.ts:56](packages/core/src/database/sqlite.bun.ts:56)); `persistEvent` also opens a **nested** immediate transaction per event for no benefit ([event.ts:272](packages/core/src/event.ts:272)). Heavy tool output stalls SSE fan-out and HTTP for all sessions on the coordinator.
- 🟡 `cleanupEmpty` runs on **every** `session.list` — unindexable LIKE scan + 5 probe queries per candidate; every sidebar refresh pays it ([session.ts:622](packages/opencode/src/session/session.ts:622)).
- 🟡 `SessionStatus.get/list` run `recover()` (two full-table scans in an immediate transaction under the event barrier) on **every read** ([status.ts:84](packages/opencode/src/session/status.ts:84)). Make recovery periodic.
- 🟡 Idle wakeups: state-log 1s poll (mostly redundant with its event trigger), job dispatcher full `jobs.list()` every 10s even with zero jobs, capability payload recomputed+hashed per 1s GUI poll with no digest cache, coordinator lease files rewritten every 2s per client (AV-scan noise on Windows).
- 🟡 GUI: `displayMessageText` re-runs a regex + a throwing `JSON.parse` attempt over the full accumulated text every 16ms flush while streaming ([message-text.ts:6](packages/gui/src/renderer/src/lib/message-text.ts:6)) — O(len²) per streamed message; deep structural equality (`sameValue`) over full card catalogs and diff patch text per flush instead of comparing the digest the state already carries; "Load more" permanently disables transcript trimming and the transcript is windowed but not virtualized.
- 🟡 TUI: streaming re-renders pass `part.text.trim()` (full copy) per batch; per-hint `indexOf` scans are O(n) at transcript scale; `sync-v2` accumulates per-session arrays for **any** session unboundedly (flag-gated today).
- Unbounded memory summary: TUI `sessionDetails`/`fullSyncedSessions` (critical above), the durable `event` table (disk), `sync-v2` arrays (flag-gated). Bounded and healthy: GUI inactive-session cache (16), markdown cache (4MB), dedupe rings (2k), part-normalization WeakMap.

### 4.3 Perf tooling

`perf/test-suite.md` is a lab notebook for making the **test suite** faster (implemented: `bun run bench:test` / `profile:test` in `packages/opencode`; full suite ~250s → ~190-200s), not a runtime perf suite. Runtime perf coverage exists only in the GUI: `e2e-performance/` with CI-enforced budgets (cold/cached switch p95, DOM counts, long tasks). There is **no backend or TUI performance testing**. Note: `script/trace-imports.ts:5` has a hardcoded upstream developer path (`/home/thdxr/...`) — the import-graph startup tooling is broken in this fork.

---

## 5. Dead code inventory

| Item | Size | Evidence | Action |
|---|---|---|---|
| 🟠 `packages/ui` — 128 of 160 files | ~19k LOC + most of 13.7k CSS + assets | Import graph traced from all consumers: GUI imports ~12 modules + 4 `v2/` controls; TUI imports 4 audio files. Dead: `message-part.tsx` (2,438 LOC — largest file in the slice), `session-review/turn`, all of `hooks/`, `theme/`, `storybook/`, the entire widget tier; 17 of 18 i18n locales; 10 test files keep dead components green in CI | Prune to the ~32 reachable modules (or vendor into GUI); switch GUI to scoped CSS imports |
| 🟠 `packages/effect-sqlite-node` | 168 LOC | Zero imports repo-wide; superseded by `packages/core/src/database/sqlite.node.ts`; lingers as unused dep in `packages/core/package.json:65` + workspace entry | Delete package, dep, workspace + policy entries |
| 🟡 `packages/opencode/src/ide/index.ts` | 70 LOC | Zero importers; installs **upstream's** VS Code extension `sst-dev.opencode` | Delete |
| 🟡 PTY HTTP surface | `groups/pty.ts` (8 endpoints) + `src/pty/` (7 files) | No first-party callers (GUI uses local node-pty over IPC; TUI is in-process) | Delete or mark third-party-only |
| 🟡 GUI dead CSS | ~40 selectors across 5 workbench files | Removed "project browser" feature left `.project-browser-*` etc. with zero TS references ([base-8.css](packages/gui/src/renderer/src/styles/pages/workbench/base-8.css)) | Sweep; the design-system gate checks tokens, not unused selectors |
| 🟡 `@openauthjs/openauth` | dep | Zero imports anywhere; upstream hosted-auth residue (root catalog + `packages/opencode/package.json:114`) | Remove |
| 🟡 `script/publish.ts` + `script/release` | — | Hard-gated legacy publishing; `script/release:11` dispatches a **nonexistent** `publish.yml`; sole reference keeping `packages/extensions` alive | Delete both + `packages/extensions` |
| 🟡 GUI dead helper modules | ~50 LOC | `lib/live-sync.ts`, `lib/session-activity.ts` — referenced only by their own tests (pre-authoritative-sync polling era); duplicate terminal `ipcMain.handle` registrations unreachable behind the `.on` variants ([terminal-ipc.ts:120](packages/gui/src/main/terminal-ipc.ts:120)) | Delete |
| 🟡 SDK dead surface | — | `v2/data.ts` helper with hardcoded `id: "asdasd"` placeholder IDs; committed stale `packages/sdk/openapi.json` (692 KB, only writer is the dead `script/generate.ts`); exports with no consumers (`./v2/server`, `./v2/legacy-session-sync`, `./v2/gen/client`) | Delete |
| ⚪ TUI dead components | — | `dialog-tag.tsx`, `dialog-subagent.tsx` (zero importers); dead third status algorithm at [sync.tsx:666](packages/opencode/src/cli/cmd/tui/context/sync.tsx:666) | Delete |
| ⚪ ~~`sync/steal`~~, `tui/appendPrompt` endpoints; `src/sync/` schema+README stub; ~~`storage/json-migration.ts` (437 LOC one-time import)~~ | — | No callers / superseded / sunset-eligible | Review & remove |
| **CORRECTION (2026-07-29)** | — | The row above is wrong about two of its four entries. **`/sync/steal` has a caller** — `control-plane/workspace.ts:793`, during session warp into another coordinator's workspace. **`storage/json-migration.ts` has three callers** — `src/index.ts:34`, `src/gui-coordinator-runtime.ts:7`, and a re-export from `src/node.ts:6`; it is the one-time JSON→SQLite import path. | Both **kept**. The `tui/appendPrompt` server route was removed (a stale binding survives in the frozen v1 generated SDK, `packages/sdk/js/src/gen/sdk.gen.ts`); the `src/sync/` README+schema stub is still there and still unreviewed. |
| ⚪ `build.sh:183-186,209-212` | — | `exit 1` immediately precedes unreachable "continuing anyway" warns | Fix (behavior contradicts comments and DEV_README) |

---

## 6. Bad code / rewrite candidates

- 🟠 **`session/prompt.ts` (2,514 LOC)** — god module: prompt admission, command claiming/leasing, agent loop, shell execution, subtask handling, structured output, **and** swarm/Claude-driver branching, ~70 imports. The CAS command machinery (lines ~1906-2230) is correct-looking but deserves its own module.
- 🟠 **Two parallel interactive TUIs.** `cmd/tui/` (36k LOC) and `cmd/run/` (16.8k LOC) each implement theming, a prompt editor (1,204 vs ~2.5k LOC), permission UI, question UI, and scrollback rendering. Every composer/permission feature must be built twice. Extract a shared core or explicitly freeze `run --interactive`.
- 🟠 **Tool-output rendering exists 4×** (5× counting the GUI): `run/tool.ts` (1,489 LOC), TUI v1 renderers, TUI v2 renderers, dead `ui/message-part.tsx`. Any new tool needs 3+ renderer updates.
- 🟡 **GUI four-layer session caching** ([authoritative-state-controller.ts](packages/gui/src/renderer/src/controllers/authoritative-state-controller.ts) + hydration/presentation caches, coordinated by version maps and deferred release; ships its own retention telemetry). Works and is tested, but it's the highest-cognitive-load subsystem in the GUI — first place a rewrite discussion should look.
- 🟡 **The GUI's 500-line file cap is reshaping code, not just limiting it.** The 10 largest files all sit at 348-484 LOC (just under the ceiling); module families split by size not concept (`session-side-*` × 24 files, `live-session-*` × 5, `store-*` × 6); 98 CSS files named `base-N.css` where workbench's `base-4`/`base-5` were deleted and never renumbered — the numbers carry no meaning, and cascade order silently depends on a 90-line `@import` list. Tooling prevents corruption (duplicate-selector/token/`!important` gates); humans can't find anything. Keep the gate, forbid `-N` suffixes, re-split by feature name.
- 🟡 **Duplicated core↔opencode logic:** two `Identifier` generators with separate counter state (interleaved IDs aren't mutually monotonic), path/filesystem helpers duplicated verbatim, flock wrapped twice.
- 🟡 **Error posture:** 314 `orDie` uses in non-CLI opencode — every DB error is a fiber death → HTTP 500; a `SQLITE_BUSY` outlasting the 5s timeout kills the request rather than surfacing retryable. 153 fire-and-forget `.catch(() => {})` in `cli/` (mostly deliberate). `client-sync-controller.ts` (1,299 LOC, the largest hand-written SDK file) has two silent error swallows and is a complexity hotspot.
- ⚪ `OPENCODE_SKIP_MIGRATIONS` skips running migrations but **still records them as applied** ([migration.ts:55](packages/core/src/database/migration.ts:55)) — a footgun that permanently marks a DB migrated without the schema. `config/route.tsx:56` does an unguarded `JSON.parse` of an env var. `lib/store.ts` in the GUI is misnamed (it's an API facade, not a store) and carries formatter-skipping indentation damage.
- ⚪ TUI imports server internals directly (`@/provider/provider`, `@/session/session` from TUI components) — works in-process but blurs the client/server boundary the SDK enforces; matters for `attach` and any future split.

---

## 7. Incomplete / partially-functional features

| Feature | State | Evidence |
|---|---|---|
| 🟠 v2 message/event system | Mid-flight: 15+ `TODO(v2)` dual-write sites in `session/processor.ts`; ~1,500 LOC replacement in core + ~2,000 LOC TUI consumer, all behind default-off `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`; production model named `SessionLegacy` (naming inversion that will confuse every newcomer); the v2 `session-message-updater` test file is fully skipped; TUI `SyncProviderV2` mounts unconditionally even with the flag off | [runtime-flags.ts:48](packages/opencode/src/effect/runtime-flags.ts:48), [app-runtime.tsx:114](packages/opencode/src/cli/cmd/tui/app-runtime.tsx:114) |
| 🟠 Native LLM path | Strategic bet, gated behind `OPENCODE_EXPERIMENTAL_NATIVE_LLM`; runtime gate admits only openai/anthropic/`opencode*` — **3 of 11 provider adapters reachable**; Azure/Google/Bedrock/OpenRouter wired but blocked; cloudflare/copilot/xai reachable only from tests | [native-runtime.ts:47](packages/opencode/src/session/llm/native-runtime.ts:47) |
| 🟠 Plugin API on frozen SDK | Plugin types built on v1 SDK gen unchanged since fork inception (0 fork identifiers vs 154 in v2) — plugin authors see a pre-fork server contract | [plugin/src/index.ts:1](packages/plugin/src/index.ts:1) |
| 🟡 `BACKEND_SYNC_PROGRESS.md` "Remaining Work" | All five items verified still true: no filesystem-to-event outbox (crash window between file rename and invalidation publish), no durable journal for multi-file plugin writes, core event journal unbounded (see §4), authority not enforced at `Database.defaultLayer` (any `opencode serve` can open the GUI's DB concurrently), no restart/slow-client soak test | doc + code cross-check |
| 🟡 GUI documented follow-ups | `/connect` doesn't auto-open model picker; `/workspaces` lacks creation/adapters; `/warp` partial; `/editor` lacks non-text part rehydration | `packages/gui/SLASH_COMMAND_PARITY.md` |
| 🟡 GUI themes | Two themes vs TUI's 30; only extension point is plugin theme variables | [session-actions-controller.ts:237](packages/gui/src/renderer/src/controllers/session-actions-controller.ts:237) |
| 🟡 Jobs | Durable store, dispatcher, events — **no UI in either client** | — |
| ⚪ Dark-launched TUI features | Session-switcher (819 LOC), workspace commands + 4 dialogs, which-key (ships `enabled: false`) — all behind env flags, invisible by default | [internal-tui-manifest.ts:39](packages/opencode/src/plugin/internal-tui-manifest.ts:39) |
| ⚪ GUI plugins | Declarative-only by design (theme vars/commands/snippets); network/fs/shell/backend permissions explicitly unsupported; expectation-setting needed in UI | [gui-plugins.ts:62](packages/gui/src/renderer/src/lib/gui-plugins.ts:62) |
| ⚪ Design system | Actively in progress, not abandoned: Phases 0-2 landed with CI ratchets; Phase 3 (~1,935 raw-value findings to migrate) + 4-6 open | `DESIGN_SYSTEM_PLAN.md` §11 |

TODO census across the repo is remarkably low: 1 in the TUI slice, 28 in backend (15 concentrated in `processor.ts`), 0 in the GUI, 2 in supporting packages (both inside generated code).

---

## 8. Fork cruft & repo hygiene

### 8.1 🔴 Data flows to upstream infrastructure (policy decision required)

These contradict ROADMAP.md ("Nix, hosted enterprise infrastructure, Slack, websites, editor extensions, preview CLI, and upstream front ends are not supported products"):

1. **Share pipeline** posts full session transcripts to `https://opncd.ai` ([share-next.ts:213](packages/opencode/src/share/share-next.ts:213)) — reachable from GUI/TUI `/share`, auto-share config, the GitHub Action's `share: true` default for public repos, and `opencodex import`. Kill-switch exists (`OPENCODE_DISABLE_SHARE`) but the default sends data to infrastructure the fork doesn't control.
2. **Web-UI catch-all reverse-proxies `https://app.opencode.ai`** ([ui.ts:9](packages/opencode/src/server/shared/ui.ts:9)) — the fork deleted `packages/app`, every build passes `--skip-embed-web-ui`, so the registered `web` command always lands on the upstream proxy, forwarding request bodies/headers. Quiet egress path; remove the proxy fallback.
3. **Console/account login** targets `https://console.opencode.ai` (upstream enterprise console) — wired into TUI bootstrap (`experimental.console.get` fetched every boot), a "Switch org" command, and a dialog. `session/retry.ts` upsells upstream's paid gateway (`opencode.ai/go`); provider dialog advertises Zen/Go.
4. **GitHub Action** defaults OIDC exchange to `https://api.opencode.ai` (will not recognize this fork's app — a silent dead end) and `share: true` posts CI sessions to opncd.ai.

### 8.2 🟠 npm scope

`@opencode-ai/sdk`, `@opencode-ai/plugin`, `@opencode-ai/script` are **not** `"private": true` and are named under upstream's npm scope; the only fence against publishing into a scope this fork doesn't own is an env-var guard in three publish scripts. Add `"private": true` or rename the scope until a registry policy exists.

### 8.3 Upstream sync machinery

The tracking system (`upstream/lock.json` + `policy.json`, status/rehearse scripts, monthly nag issue, CI `surface:audit`) is unusually disciplined fork hygiene. Caveats:

- 🟠 **Policy path bug:** `upstream/policy.json:61-63` lists `containers`, `identity`, `extensions` as bare top-level names but the fork's copies live under `packages/` — so `surface:audit` passes while pruned products remain tracked. One-line fixes make CI enforce their removal permanently. (Related: bare `exists()` checks make a **local** `surface:audit` fail on the empty `packages/slack`/`packages/cli` dirs that CI can't see.)
- 🟡 Pinned v1.15.13 vs latest v1.18.3 — 3 minors / ~2 months behind, zero backports. Because history is a snapshot import without common ancestry, every sync is an unrelated-histories merge; conflict surface grows monotonically with delay, and the status script's regex categorization silently miscategorizes upstream path restructures.
- 🟡 8 patched dependencies re-verify on every bump and complicate dependency reconciliation during sync. The `solid-js` patch contains junk hunks from another machine's checkout. Four patches are upstreamable bugfixes.

### 8.4 Branding / misdirected endpoints

- 🟡 **TUI crash screen files bug reports at `github.com/anomalyco/opencode/issues`** (upstream's repo) — [error-component.tsx:23](packages/opencode/src/cli/cmd/tui/component/error-component.tsx:23). Fix the URL.
- ⚪ `SECURITY.md` escalation email is `security@anoma.ly` (upstream's domain) — reports won't reach this fork's maintainer.
- ⚪ Terminal titles say "OpenCode"/"OC |"; attention pack name "OpenCode Default"; schema URLs point at `opencode.ai/*.json`; tips advertise upstream's docker image and share site; `packages/script` computes release versions by fetching **upstream's** npm package.
- ⚪ Editor-extension leftovers still ship: `cmd/acp.ts` (Zed/editor ACP server) and `context/editor-zed.ts` despite ROADMAP exclusion.

### 8.5 Committed junk & local disk

- 🟡 Tracked: `test-results/.last-run.json` (Playwright output; `test-results/` missing from `.gitignore`), `Screenshots/` (one dev screenshot, referenced nowhere).
- 🟡 Git history on `main` permanently carries ~75 MB: two upstream marketing videos (27 MB) from the snapshot-import commit and 9 pre-gitignore revisions of `graphify-out/graph.json` (~47 MB) + `graph.html`. History rewrite is optional and higher-risk — flag for a deliberate decision. Local pack is 497 MiB (clone also carries the full upstream remote + 1,072 upstream tags — prunable locally).
- ⚪ Untracked disk hazards: `artifacts/` **1.3 GB** (baseline binaries + ~430 MB of debug JSON dumps from June), `graphify-out/` 13 MB **stale** (built from a commit 63 behind HEAD), `packages/gui/.artifacts/` 290 MB of E2E debris that the harness never prunes.

---

## 9. Build, CI, testing, docs

### 9.1 Build

Single binary via `Bun.build` compile with embedded models.dev data; a `--gui-coordinator` variant builds the GUI sidecar. Windows local builds go through WSL (rsync to `/tmp` to dodge virtiofs symlink issues) — although CI **natively builds the win32 sidecar on windows-latest and cross-compiles all release targets from Ubuntu**, so the WSL requirement is a local-filesystem workaround, not a toolchain constraint; document exactly what breaks natively.

- 🟠 **Default build is broken:** [build.ts:35](packages/opencode/script/build.ts:35) references `../../app` which doesn't exist; any build without `--skip-embed-web-ui` fails — and `CONTRIBUTING.md:61` tells contributors to run exactly that. Make skipping the default.

### 9.2 CI

Strong: Linux+Windows unit matrix, separate CLI-subprocess job (documented 3.3× slowdown rationale), path-gated Chromium GUI E2E **with enforced performance budgets**, five bespoke guard scripts, manual-dispatch releases that rerun the full quality gate, signing validation, monthly upstream-status cron. Weak spots:

- 🟠 **No macOS CI anywhere** despite shipping darwin binaries and building GUI releases on macOS runners — macOS regressions surface first at release time.
- 🟠 The entire typecheck/lint stack rides on **`tsgo` (`@typescript/native-preview`, a dated dev snapshot)** + `oxlint-tsgolint`; a green typecheck is not a guarantee `tsc` agrees. Keep a periodic `tsc --noEmit` cross-check.
- 🟡 2,630 baselined lint warnings with a global-count-only ratchet — no per-file attribution, no burn-down.
- 🟡 File-watching has effectively **zero CI coverage**: the watcher suite is `describe.skip` under CI by design, and Windows CI additionally sets `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true` (tested surface ≠ shipped surface).
- 🟡 Packaged-Electron smoke is manual-dispatch-only; Electron-native E2E is one spec, not in CI — terminal PTY, embedded browser, native dialogs, sidecar spawn/reattach, and window lifecycle have no automated native coverage (the biggest testing gap in the GUI).
- ⚪ Prettier is configured but there's no CI format check. `turbo.json` `passThroughEnv: ["*"]` on test tasks is a footgun if remote caching is ever enabled. Pre-commit hooks re-stage whole files (destroys partial staging) and run GUI design-system checks on every commit; `.husky/graphify-update` is not a valid hook name and never runs.

### 9.3 Testing summary

497 test files; heavy where it matters (opencode 301, gui 97, core 58). Zero tests: `packages/plugin`, `packages/script`, `packages/effect-sqlite-node`. Coverage-relevant skips: the entire watcher suite (never in CI), the fully-skipped v2 session-message-updater file, ~10 scattered unconditional skips. GUI component wiring is E2E-only by strategy ("pure logic in lib/ + E2E screenshots"). The GUI parity test deep-imports TUI internals — a TUI file move breaks GUI CI (export the projection from a stable entry point). No backend/TUI perf tests (§4.3).

### 9.4 Docs

Newer docs are accurate on spot-check (`docs/UPSTREAM.md`, `docs/ARCHITECTURE.md`, `RELEASE_GUIDE.md`, `docs/session-sync-compatibility.md`, `docs/gui-control-acceptance.md`). The older ones have drifted badly:

- 🟠 **`DEV_README.md`** — repo layout lists six nonexistent packages (`function`, `enterprise`, `docs`, `slack`, `cli`, plus a `nix/` dir), **omits `packages/gui` and `github/` entirely**, mislabels `install` as an upstream leftover (it's the fork's shipped installer), claims default branch `dev` (it's `main`), describes a tag-triggered release that doesn't exist, references `docs/opencodex-upstream.md` (superseded by `docs/UPSTREAM.md`) and a nonexistent `script/stats.ts`, and contradicts AGENTS.md on assistant lint policy. The fork's primary onboarding doc needs a rewrite pass.
- 🟡 **`CONTRIBUTING.md`** — largely upstream boilerplate: upstream issue/Discord links, nonexistent `VOUCHED.td`, and the broken build command from §9.1.
- 🟡 **`BACKEND_SYNC_PROGRESS.md`** — accurate but ~4 days stale: migration count is 40 not 37, the entire Claude Code terminal-driver subsystem is absent, and it ends with leftover session-log residue ("the worktree is intentionally dirty" — it isn't).
- ⚪ `RELEASE_GUIDE.md` expected-asset names (`opencode-*`) don't match the workflow's renames (`opencodex-*`); "There is no Docker" vs `compose.gui-e2e.yaml`; `.opencode/` contains both `opencode.json` and `opencode.jsonc` with different content.

---

## 10. Non-ideal architectural decisions (summary judgment)

1. **Durable event journal without lifecycle management** — the fork built proper retention for its own `opencodex_state_event` but left the core `event` table unbounded and unindexed. Same team, two standards; the older one is the hotter path (§4.1).
2. **Parity maintained by convention at the edges** — the shared SDK engine was the right call, but everything outside it (status derivation, normalizers, transport loops, coordinator protocol) is duplicated by hand with string-grep guards. The fix is mechanical: keep pushing duplicated logic down into `sdk/v2` where the contract test already lives (§3).
3. **No version handshake in a multi-process, mixed-version world** — coordinator sharing between independently-updated GUI and TUI binaries with no compatibility gate (§3.3).
4. **Two interactive terminal surfaces** — `cmd/tui` and `cmd/run` double every composer/permission feature (§6).
5. **The 500-line cap without naming discipline** — produced 98 numbered CSS files and concept-split module families; the gate outlived its intent (§6).
6. **TUI full-transcript data model** — correct for small sessions, quadratic-ish in practice for the multi-session long-running use case the product is built for (§4.1).
7. **Two migration sources reconciled by no-op markers** — hand-written TS migrations + Drizzle snapshot with `SELECT 1` reconciliation markers (2 already); workable but a recurring tax, and `OPENCODE_SKIP_MIGRATIONS` records-without-running (§6).
8. **Snapshot-import fork with growing sync debt** — excellent tooling, no executed sync; the longer the pin lags, the harder the first merge (§8.3).
9. **Experimental toolchain as the only gate** — tsgo + oxlint baseline means type/lint greenness has known epistemic gaps (§9.2).
10. **In-process client/server boundary erosion** — TUI importing server internals works today and will hurt exactly when `attach`/remote scenarios matter (§6).

---

## 11. Recommended action plan

### Quick wins (hours, no design decisions)

1. Add `(aggregate_id, seq)` index to the `event` table.
2. Fix the TUI crash-report URL to this fork's repo; fix `SECURITY.md` contact.
3. Delete: `packages/{slack,cli,identity,extensions,containers,effect-sqlite-node}`, `src/ide/index.ts`, `script/publish.ts`, `script/release`, `@openauthjs/openauth`, `test-results/` (+ ignore), `Screenshots/`, GUI dead helpers + duplicate IPC handlers, `dialog-tag.tsx`/`dialog-subagent.tsx`, SDK `v2/data.ts` + stale `openapi.json`.
4. Fix `upstream/policy.json` pruned paths to `packages/…` form so CI enforces the deletions permanently.
5. Add `"private": true` to the three `@opencode-ai/*` packages pending a registry policy.
6. Make `--skip-embed-web-ui` the build default; fix `CONTRIBUTING.md`'s build command; fix `build.sh`'s unreachable-warn dead code.
7. Local disk: delete `artifacts/` (1.3 GB) and stale `graphify-out/`; prune upstream remote refs/tags.

### Near-term (days, high leverage)

8. Throttle/coalesce tool-metadata updates and stop persisting transient `running` part revisions durably (§4.1 — the single biggest perf fix).
9. Add retention/compaction to the `event` table; flatten the nested immediate transaction in `persistEvent`.
10. TUI: page transcripts like the GUI, release session details on route leave, virtualize the transcript `<For>`.
11. Move `deriveStatus`, `displayMessageText`, the envelope normalizer, and `isLikelyActiveSession` into `sdk/v2`; assert them in the contract parity test. Delete the GUI's dead second reducer or extend the boundary guard to the whole tree.
12. Add server version to the coordinator manifest + `/global/health` and enforce a compatibility range in both attachers.
13. Make `cleanupEmpty` and `SessionStatus.recover()` periodic instead of per-read; scope `jobs.list()` to active statuses.
14. Add GUI OS notifications from the shared attention items; surface `installation.update-available` in the GUI.
15. Rewrite `DEV_README.md`'s layout section; refresh `BACKEND_SYNC_PROGRESS.md` or fold it into `docs/ARCHITECTURE.md`.

### Strategic decisions (need an owner's call)

16. **Upstream data egress policy:** remove/repoint share (`opncd.ai`), the `app.opencode.ai` proxy + `web` command, console login, and Action OIDC defaults — or explicitly document them as supported upstream-service integrations. Today's defaults contradict the ROADMAP.
17. **v2 event system:** finish it or park it explicitly; either way rename `SessionLegacy`, fence `SyncProviderV2` behind its flag, and un-skip or delete its tests.
18. **`packages/ui` prune** (~19k LOC) and the GUI CSS re-organization (semantic names over `base-N`).
19. **`cmd/run` vs `cmd/tui`:** extract a shared composer/permission core or freeze `run --interactive`.
20. **Plugin API:** migrate to the v2 SDK (then delete the frozen v1 gen).
21. **Execute the first upstream sync** (rehearsal tooling is ready; debt grows monthly) and decide the patched-deps upstreaming plan.
22. **Native LLM rollout:** widen the provider gate or drop the unreachable adapters; decide the AI-SDK fallback's end state.
23. Optional: history rewrite to drop ~75 MB of upstream media/graph blobs from `main`.

---

## Appendix A — Where to look first (new-maintainer map)

| Question | Start here |
|---|---|
| How do clients stay in sync? | `packages/sdk/js/src/v2/client-sync-controller.ts` (+ `client-sync-events.ts`), then `packages/gui/test/state-contract.parity.test.ts` |
| Where do writes happen? | `packages/core/src/event.ts` (barrier → transaction → journal), `packages/opencode/src/opencodex/state-log.ts` |
| How does the TUI boot? | `packages/opencode/src/cli/cmd/tui/thread.ts` → `coordinator-registry.ts` |
| How does the GUI boot? | `packages/gui/src/main/index.ts` → `sidecar.ts` |
| Where is the prompt loop? | `packages/opencode/src/session/prompt.ts` (god module — see §6) |
| What invariants does CI enforce? | `script/check-*.ts` (six guard scripts), `.github/workflows/ci.yml` |
| How is upstream tracked? | `docs/UPSTREAM.md`, `upstream/lock.json`, `upstream/policy.json` |
| Known debt registers | This file; `BACKEND_SYNC_PROGRESS.md` "Remaining Work"; `packages/gui/SLASH_COMMAND_PARITY.md`; `DESIGN_SYSTEM_PLAN.md` §11 |
