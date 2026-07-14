# Current-branch GUI/TUI audit register

This register treats commit 9fdb5601ab8209d373c5f9a67c65ea57936d9af4 plus the working tree captured on 2026-07-13 as the product baseline. No conclusion, priority, or implementation choice depends on main or origin/main.

## Baseline and method

- The initial audit manifest contained 116 dirty entries. The implementation manifest now contains 420 entries: 104 modified, 27 deleted, and 289 untracked. Existing work was preserved; extracted modules account for most of the additional entries.
- Graphify was refreshed from the final working tree with graphify . --update --no-viz. The ignored current-tree index contains 7,154 nodes, 17,583 edges, and 179 communities.
- Generated SDK output is excluded from the authored-module size gate. The audited source surface covers GUI renderer/main/preload code, Opencode TUI code, OpencodeX state/Job/Swarm code, instance HTTP API code, and the shared SDK v2 controller.
- The final authored scan covers 629 TypeScript, TSX, and CSS files. No file exceeds 500 lines. The largest file is a 496-line responsive CSS layer; the largest component and controller owners are 493 and 492 lines.
- The pre-change hotspots were GUI app.tsx at 3,525 lines, TUI operations at 3,391, TUI session route at 2,501, TUI prompt at 2,456, GUI session side panel at 2,413, Swarm service at 2,240, TUI sidebar at 1,961, TUI app at 1,443, and SDK state synchronization at 1,192.
- Current composition roots are GUI app.tsx at 197 lines, Workbench at 414, session side panel at 493, TUI app at 2, TUI session route at 15, Swarm public service at 99, SDK lifecycle controller at 488, and public OpenAPI normalization at 466.
- The SDK suite passes 32 tests, the GUI suite passes 303 tests across 51 files, and the full Opencode CI runner passes 197 parallel files in 43 process-isolated shards plus its serial snapshot, project, file, TUI, run, ACP, serve, and smoke suites.
- The root CI orchestration passes all 10 scheduled package tasks in 607.5 seconds. Workspace typecheck passes all 13 scheduled package tasks. Legacy-sync and direct-client-reducer boundary guards pass.
- GUI production build passes. SDK regeneration completes with generated route contracts unchanged. The supported current-platform Opencode binary build passes with --single --skip-embed-web-ui --skip-install and a disposable XDG root; its --version smoke test passes.
- Lint baseline passes with 2,706 warnings against the prior 2,736-warning ceiling. New work does not raise the repository baseline.
- Chromium and packaged Electron automation are environment-gated on this Windows workspace by EPERM while Bun reads the installed Playwright package. Live Chromium inspection used the disposable E2E server and disposable project/session data; no prompt or billed operation was executed.

## Severity and completion

- P0: data loss, security failure, or broadly unrecoverable product failure.
- P1: correctness race, restart inconsistency, blocked primary workflow, native-resource leak, or structural hotspot that prevents safe maintenance.
- P2: material usability, accessibility, or performance defect with a workaround.
- P3: low-frequency polish.
- Fixed means source and focused acceptance checks pass. Implemented / gated means the source fix and available checks pass, but a required packaged or fixed-run environment remains unavailable. Backlog means evidence is captured and ranked below.

No P0 finding was discovered.

## Findings

| ID | Surface | Severity | Evidence and impact | Fix and acceptance | Status |
| --- | --- | --- | --- | --- | --- |
| STATE-001 | SDK, GUI, TUI | P1 | A dropped state stream exposed only legacy phase/error, used fixed reconnect timing, and gave clients no shared stale/reset state. | Added lifecycle and per-session page-load states, 500 ms-30 s bounded exponential backoff with ±20% jitter, ready-frame reset, stale snapshot retention, and immediate retry(). | Fixed; lifecycle, reconnect, reset, idle-request, and paging tests pass. |
| STATE-002 | Persisted server status | P1 | Historical busy and retry events could be restored after restart, leaving a session falsely active. | Runtime status now comes only from the live status map. Persisted seen/reviewed/file-review state remains durable; needs_review, input_needed, and idle remain server-derived. | Fixed; restart semantics are tested. |
| STATE-003 | GUI session hydration | P1 | Selected sessions and View panes used overlapping caches and could duplicate loads or retain inactive detail indefinitely. | A dedicated presentation controller pins visible sessions, deduplicates matching loads, retains 16 inactive LRU details, and evicts on scope/epoch/deletion. | Fixed; controller tests pass. |
| SWARM-001 | Job cancellation | P1 | Cancelling a running Job terminalized aggregate state while its executor and lease could still be active. | Queued Jobs cancel immediately; claimed/running Jobs retain lease and status with cancelRequestedAt until executor acknowledgement. Both clients render Cancelling. | Fixed; cancellation/lease race tests pass. |
| SWARM-002 | Transactional settlement | P1 | Job, run, role, agent-run, aggregate, and durable-event writes had separate commit points. | Dispatcher registration accepts an executor and transactional settlement handler. Terminal Job and aggregate writes commit together; broadcasts and follow-up reconciliation happen after commit. | Fixed; rollback and settlement tests pass. |
| SWARM-003 | Restart idempotency | P1 | Worker/synthesis sessions and prompts were created inside execution, so retry could duplicate a hidden session or phase prompt. | Deterministic session and prompt IDs persist before dispatch. Restart reuses terminal results, resumes incomplete prompts, creates only absent prompts, and provisions one synthesis Job per run. | Fixed; orchestrator, worker, and synthesis reload tests pass. |
| SWARM-004 | Partial and recovered runs | P2 | Mixed worker outcomes collapsed into failure and startup repair could fail healthy queued work before registration. | Reconciliation repairs aggregates from durable Jobs, preserves healthy queued/active work, and synthesizes mixed results as partially_failed. | Fixed; partial-failure and recovery tests pass. |
| LAYOUT-001 | GUI shell | P1 | Route-dependent :has() rules and late overrides produced the wrong scroll owner and unused page space. | Routes explicitly declare scroll-page or full-bleed; shell-to-leaf sizing uses a single height: 100% / min-height: 0 chain and one intentional overflow owner. | Fixed in source and live geometry; automated viewport matrix is gated. |
| LAYOUT-002 | Workbench preview | P2 | Editor, image/binary canvas, Git preview, artifacts, and browser hosts did not consistently consume remaining height; base64/binary payload forms were inconsistent. | Leaf hosts fill the local content box, image canvases fill without stretching images, binary/image payloads normalize at one boundary, and cached content remains visible during background refresh. | Fixed; Workbench tests and live inspection pass. |
| LAYOUT-003 | Views, 1-8 panes | P1 | At 980×680, a closed side panel added 14 px document overflow, an open panel escaped its route, compact panes repeated large empty branding, and the editor nested short scrollers under a fixed Save panel. | Closed width is zero, the open panel is route-contained with an explicit close action and inert hidden state, compact Views use density metadata and a 260×220 minimum pane grid with inner workspace scrolling, and the responsive editor has one stage scroll owner. Eight-pane editing disables only additions. | Fixed; layout helpers cover 1-8 panes and live 980×680 geometry has no document overflow. |
| BROWSER-001 | Electron native browser | P1 | Inactive native views were parked at 1×1 and bounds missed some resize/DPI/focus transitions, allowing a view to cover another route. | Inactive views use the native hide path. Active bounds use ResizeObserver plus window, visual viewport, focus, route, and tab scheduling; cleanup destroys owned views. | Implemented / gated; typecheck and geometry assertions exist, packaged Electron still must run on CI. |
| BROWSER-002 | Browser fallback | P2 | Non-Electron and unavailable native-browser states left an empty or misleading host. | A semantic fallback explains availability, retains URL controls, and keeps browser content ownership within its route. | Fixed; browser-state tests pass. |
| ARCH-001 | GUI application shell | P1 | app.tsx owned synchronization, hydration, navigation, commands, dialogs, mutations, drag/reorder, and all route composition. | Navigation, authoritative state, session presentation, capabilities, operations, palette, appearance, rail, dialogs, and route composition now have independent owners. app.tsx is 197 lines. | Fixed; GUI typecheck and core tests pass. |
| ARCH-002 | GUI side panel and Workbench | P1 | The side panel mixed terminal, files, Git, review, native browser, persistence, and drag behavior; Workbench repeated some of those operations. | Terminal, files/search/buffers, review, Git, browser, diagnostics, artifacts, persistence, tab measurement/drag, and pane layout have single owners shared by composition surfaces. Side panel is 493 and Workbench is 414 lines. | Fixed; focused tests pass. |
| ARCH-003 | TUI operations and sidebar | P1 | Large components coupled resize/focus/key handling to projection and duplicated Swarm display rules. | Shared Swarm presentation lives in the SDK; operations and sidebar are thin compatibility surfaces over data, controller, dialog, keyboard, card, row, and layout modules. | Fixed; typecheck and key/order tests pass. |
| ARCH-004 | TUI app, session, and prompt | P1 | Top-level lifecycle, 31 commands, subscriptions, route layout, tool rendering, draft/history, autocomplete, workspace, and submit logic were concentrated in three files and leaked ownership boundaries. | Runtime/providers, navigation/system/provider commands, event ownership, session state/commands/layout/tool dispatch, prompt state/submit/bindings/view/workspace/extmarks/paste/options each have focused owners. Subscriptions and timers clean up with the owning Solid scope. | Fixed; all reviewed owners are below 500 lines and focused tests pass. |
| ARCH-005 | Swarm, HTTP API, and SDK | P1 | Swarm service mixed schema through restart repair; public OpenAPI normalization was 536 lines; SDK synchronization mixed public types, wire transport, reducers, session helpers, and lifecycle in 1,192 lines. | Swarm has schema/model/plan/read/run/execution/settlement/mutation/reconciliation owners. OpenAPI types and compatibility constants are separate. SDK exposes an unchanged 30-line facade over session, type, reducer, transport, event, and controller owners. No logic is copied between clients. | Fixed; package typechecks and focused tests pass. |
| ARCH-006 | CSS ownership | P2 | Numbered correction files duplicated downstream rules and made route sizing order-dependent. | Styles are grouped into named token, base, shell, dashboard, session, Workbench, operations, overlay, and responsive layers. All 45 authored CSS files are at most 496 lines. | Fixed structurally; remaining visual matrix is gated. |
| PERF-001 | Authoritative requests and stale work | P2 | TUI sidebar issued per-session validation and duplicate Swarm requests; GUI/TUI searches could let stale responses replace current results. | Sidebar is a pure projection of shared state. File and autocomplete searches cancel superseded work and retain last valid results during refresh. Idle synchronization has no periodic authoritative request. | Fixed; request/coalescing tests pass. |
| PERF-002 | Git list | P2 | A 422-change fixture rendered 422 rows and 3,798 DOM nodes. Large repositories would degrade input and paint latency. | Shared virtual-window logic renders the visible slice with overscan. The same fixture renders 11-18 rows and 601-663 DOM nodes; a deterministic 5,000-row window is tested. | Fixed; virtualization tests pass. |
| UX-001 | Cross-client recovery | P2 | Startup, reconnect, reset, and retry language differed between clients. | Both clients project the shared lifecycle, preserve stale data, expose retry, and pair color with text labels. | Fixed; projection tests pass. |
| UX-002 | Responsive access and contrast | P2 | The responsive side panel lacked a direct close control and hidden content remained focusable. Light-theme secondary text measured about 3.25:1 on panels. | Added explicit close/focus behavior and inert hidden state. Final light --muted is #5f6274, about 4.95:1 on the panel and 4.55:1 on element surfaces; composer statuses use tokens instead of hard-coded dark values. | Fixed; live light/dark inspection passes. |
| UX-003 | Swarm editor | P2 | Adding a same-provider role could replace native option identity and reset a prior model selection; eight-pane editing did not clearly expose its limit. | Provider-set keyed option ownership preserves selections. The View editor announces the eight-pane limit and keeps selected sessions removable while disabling only additions. | Fixed; regression tests and live inspection pass. |

## Live geometry and visual evidence

- At 980×680, closed responsive side panels produce a 980×680 document with zero extra width. Open View/session panels are contained to the route stage, expose a close control, and hidden content is inert.
- One-, four-, and eight-pane Views were exercised with disposable sessions. At eight panes, the document remains 980×680, the View workspace owns horizontal overflow, and panes retain a 260×273 visible box without cross-pane composer overlap.
- The responsive eight-pane editor uses the stage as its single scrolling owner; its content height is available by scrolling and the Save action no longer overlays a nested 224 px scroller.
- Dark and light themes were inspected at 980×680; 1440-wide shell and Workbench states were also inspected. Reduced-motion and the complete 980×680, 1180×800, 1440×960, and 1920×1080 cross-product exist as automated cases but were not executed because of the local Playwright gate.
- A disposable Swarm with two same-provider roles retained both selected models after role insertion and persistence. No Swarm execution or model prompt was started.

## Ranked backlog

1. Run packaged Electron native-view lifecycle and one-pixel host geometry assertions on Windows, Linux, and macOS. This is the remaining P1 acceptance gate.
2. Run the 16-case Chromium geometry/visual matrix on a runner without the Playwright EPERM gate and enforce the 0.2% snapshot threshold.
3. Add deterministic 5,000-session, 1,000-Job, 100-Swarm, 10,000-message, 50,000-file, 5,000-Git-change, and large provider/model fixtures across every remaining list owner.
4. Establish GUI state-to-paint, TUI key-to-frame, server snapshot, SDK reconciliation, Workbench latency, DOM/heap, and soak baselines from 20 warm runs on the fixed CI runner; enforce p95 regression greater than both 15% and 50 ms.
5. Add TUI snapshots at 80×24, 120×36, and 160×50 for empty, populated, running, input-needed, failed, cancelling, partial, and recovered states.
6. Split large GUI build chunks with route/editor/language lazy loading. Current build evidence includes several chunks above 500 KB, so this remains a delivery-size P2 even though authored source modules meet the line gate.

## Runtime gates

The hard acceptance gates remain:

- zero periodic authoritative requests while idle;
- GUI event-to-paint p95 below 150 ms;
- TUI key-to-frame p95 below 50 ms;
- no client long task above 100 ms in the large fixture;
- no monotonic memory growth and less than 15% or 50 MB growth, whichever is larger, during soak.

The idle-request gate is covered now. Timing and soak gates require the fixed 20-run CI baseline and are not inferred from developer-machine timings.
