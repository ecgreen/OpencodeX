# GUI Control Acceptance

Last updated: July 10, 2026

This matrix distinguishes controls proven in Chromium, controls proven through the real Electron main/preload boundary, and behavior that still requires replay against a packaged release artifact. “Verified” does not mean every destructive or model-billed action is executed in CI.

| Surface | Verified behavior | Evidence | Remaining gate |
| --- | --- | --- | --- |
| Startup and Dashboard | Authoritative state and capabilities load, no legacy synchronization request occurs, navigation works, and an idle client performs no periodic state request. | Chromium acceptance | Large-catalog render/CPU budget |
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
3. Add large-catalog, large-transcript, and large-Git-change fixtures with CPU, event-to-paint, memory, and DOM-node budgets.
4. Keep Jobs and Swarms marked experimental until restart, lease, cancellation, and partial-failure gates pass.
