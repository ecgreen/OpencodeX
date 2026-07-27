# GUI Control Acceptance

Last updated: July 19, 2026

This matrix distinguishes controls proven in Chromium, controls proven through the real Electron main/preload boundary, and behavior that still requires replay against a packaged release artifact. “Verified” does not mean every destructive or model-billed action is executed in CI.

| Surface | Verified behavior | Evidence | Remaining gate |
| --- | --- | --- | --- |
| Startup and Dashboard | Authoritative state and capabilities load, no legacy synchronization request occurs, navigation works, an idle client performs no periodic state request, and a 250-card production fixture remains bounded to the first 100 cards. | Chromium acceptance and production-renderer performance gates | Continue calibrating across hosted-runner generations |
| Projects | Backend-created projects appear through live state events; project detail and new-session routing work. The native multi-folder picker creates a project in an isolated Electron workspace. | Chromium and Electron acceptance | Replay against packaged release artifacts |
| Sessions | Existing sessions open, lazy new-session composer focus works, and a real Electron session opens its native side panel, PTY, and context picker. Prompt/command/shell payloads, safety actions, and transcript controls share tested handlers. | Chromium, Electron, and functional/unit tests | One non-billed prompt/abort smoke |
| Views | Create, select membership, save, open, focus, edit/delete handlers, pending panes, and multi-pane state parity are covered. | Chromium acceptance and functional/unit tests | Visual snapshots for one through eight panes |
| Swarms | Create editor, add role, bounded provider/model choices, save, open detail, and service handlers for assign/cancel/delete are covered. | Chromium acceptance and functional/unit/HTTP tests | Restart/race automation gate; keep experimental |
| Workbench Files | Workspace tree loads; Electron edits and saves exact text, including trailing newlines, through an optimistic-concurrency-safe Workbench read/write contract. Diagnostics run only when requested. | Chromium, Electron, and unit tests | Create/rename/delete rendered workflow |
| Workbench Git | Status, stage, commit, branches, changed-file list, diff selection, history/stash/remote handlers, and accessible filter controls are covered. The mutation test uses a disposable repository. | Chromium, Electron, and unit tests | Bound very large change lists |
| Workbench Browser and Terminal | The browser starts blank, native view bounds are checked after sidebar and window transitions, route changes hide the view, screenshot/navigation cross the owner-scoped IPC boundary, and a real PTY echoes a command. | Development Electron acceptance, focused controller/security tests, and packaged release acceptance on Windows, Linux, and macOS | Retain release artifacts and diagnose platform-specific failures |
| Plugins | Plugin Center opens from the command palette; filtering, safe declarative install/export/remove, and runtime list/install/toggle endpoints are covered. | Chromium acceptance and functional tests | Packaged import/export picker and hostile manifest smoke |
| Diff | Working-tree/last-turn selection, tree navigation, review state, split/unified view, and refresh handlers are covered. | Functional/unit tests | Rendered workflow and visual snapshots |
| Titlebar, menus, and shortcuts | History, route menus, command palette, keyboard help, sidebar/view-panel toggles, notifications, Cut/Copy/Paste, minimize, maximize/restore, and close are covered through desktop IPC. | Chromium, Electron, and unit tests | Replay against packaged release artifacts |
| Settings | The palette-only route controls appearance and transcript behavior through their owning controllers and exposes authoritative connection recovery. It is not duplicated in permanent navigation. | Unit tests, typecheck, and source audit | Add its approved captures to the visual matrix |

## Performance invariants now enforced

- Production fixture isolation: the backend, database, and disposable workspace live only in `.artifacts/e2e-performance/runtime`; the developer database and checkout are never used as runtime data.
- Catalog bootstrap: 250 fixture sessions produce exactly one root request, zero follow-up card requests, exactly 100 initial cards, and at most 96 KiB of decoded root response data.
- Initial rendering: collapsed dashboard and rail sections render zero session rows; the settled dashboard stays at or below 800 elements and five rendered session rows.
- Idle rendering: after settlement, no observed long task may exceed 50 ms.
- Session switching: each cold sample makes exactly one session-detail request. In-page click-to-authoritative-post-paint timing over five local samples enforces a 700 ms p95 ceiling (1,800 ms on CI); cached A-B-A makes zero additional session requests and enforces 200 ms locally (600 ms on CI) while retaining the 50 ms target in reports.
- Transcript window: a 640-message fixture initially renders exactly 128 messages. One 384-message Load More page leaves the sentinel present and moves its viewport anchor by at most 1 CSS px.
- Heavy previews: collapsed tool output remains within 200 lines / 64 KiB, expanded diff source remains product-capped at 2,000 lines / 256 KiB, and the rendered nested diff remains below 15,000 DOM elements.
- Session retention: deterministic 500-session stress keeps canonical detail state at visible sessions plus 16 inactive sessions and releases per-session loads, requests, correction timers, tail options, and event buffers.
- View scheduling: the focused pane completes first and eight-pane background hydration never exceeds concurrency two.
- Reports: every scenario attaches sanitized request/resource counts and bytes, User Timing, state-sync commits, retained card/detail counts, CDP Performance metrics, DOM counters, and renderer heap before/after forced GC when Chromium exposes it.
- Idle dashboard: no periodic root, operations, capabilities, or legacy snapshot request.
- Reduced motion: no decorative logo subtree mutation during the idle probe.
- Swarm editor: fewer than 100 total option nodes after adding a second role in the acceptance fixture.
- Workbench: opening the route does not run project diagnostics; checks require the explicit `Run project checks` button.
- Workbench: no timer-driven file or Git refresh loop.
- Dashboard entry bundle: reduced from about 2.686 MB / 808.8 KB gzip to 876.8 KB / 250.6 KB gzip by splitting session, side-panel, Workbench, Views, Swarms, Plugins, and Diff domains.
- Session workspace tools: the side-panel chunk loads only after the panel is first opened and remains mounted afterward.
- Embedded browser: new tabs start blank and never implicitly request an arbitrary service on localhost port 5173.

## Release-critical work still open

1. Keep the packaged Electron acceptance workflow green on Windows, Linux, and macOS and retain failure artifacts in CI.
2. Add rendered Diff, session safety, and delete-confirmation workflows without performing irreversible actions against a developer workspace.
3. Add a production-renderer large-Git-change fixture; catalog, transcript, event-to-paint, heap, and DOM gates are now enforced by `playwright.performance.config.ts`.
4. Keep Jobs and Swarms marked experimental until restart, lease, cancellation, and partial-failure gates pass.
