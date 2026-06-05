# GUI QA Workflow

QA owns validation evidence and issue discovery. The orchestrator owns triage and delegation back to senior engineers.

## Setup

1. Build and run the TUI from `C:\Work\OpencodeX`.
2. Create at least one OpencodeX project, session, swarm, and view in the TUI.
3. Run the GUI from the same project directory, or set `OPENCODEX_GUI_DIRECTORY=C:\Work\OpencodeX` before launching Electron.
4. Confirm the GUI dashboard sees the same records as the TUI.

## Test Loop

1. Pick one card from `docs/PARITY_CARDS.md`.
2. Run the matching TUI workflow first and note expected behavior.
3. Run the GUI workflow against the same data.
4. File every mismatch with `docs/QA_ISSUE_TEMPLATE.md`.
5. Mark severity as `P0`, `P1`, or `P2`.
6. Send issues to the orchestrator for review and assignment.

## Automation Commands

- `bun run --cwd packages/gui test`: fast store/API contract tests.
- `bun run --cwd packages/gui qa:backend-parity`: read-only backend parity check against `OPENCODEX_GUI_QA_URL`.
- `OPENCODEX_GUI_QA_WRITE=1 bun run --cwd packages/gui qa:backend-parity`: creates project/session/swarm/view records through GUI store paths, then verifies snapshots.
- `bun run --cwd packages/gui qa:issue -- --card "P0-2 Backend Data Compatibility" --severity P0 --summary "GUI cannot see TUI session"`: creates a markdown issue draft under `packages/gui/.artifacts/gui/issues`.

QA issue output is intentionally markdown-only. Do not add automatic GitHub issue creation unless the project owner changes this decision.

Backend parity environment:
- `OPENCODEX_GUI_QA_URL`: `opencodex serve` URL.
- `OPENCODEX_GUI_QA_DIRECTORY`: project directory, for example `C:\Work\OpencodeX`.
- `OPENCODEX_GUI_QA_USERNAME`: defaults to `opencode`.
- `OPENCODEX_GUI_QA_PASSWORD`: required when the server has Basic auth enabled.

## Routing Rules

- P0 data loss, wrong-session actions, permission safety, app close/move, or backend visibility issues go directly to Senior Engineer.
- P1 parity gaps go to Senior Engineer after the current P0 queue is clear.
- UX polish without missing behavior goes to design/front-end implementation after feature parity is functional.
- Ambiguous product behavior goes to Product/Architect before implementation.
- Security-sensitive permission/auth findings go to Security Reviewer before merge.

## Minimum Smoke

- Window can move, minimize, maximize, and close.
- GUI sees sessions created in TUI.
- TUI sees sessions created in GUI.
- GUI can create a project and session.
- GUI can send a prompt to an existing session.
- Dashboard reflects running, blocked, failed, and idle work states.
- Sidecar shuts down when the app exits.

## Evidence Required

- OpencodeX project directory.
- GUI build/run command.
- TUI command or workflow used as reference.
- Screenshots or a short screen recording when visual mismatch matters.
- Console logs or stack trace for crashes.
- Backend URL and directory, but never provider secrets or auth tokens.
