# GUI Smoke Tests

Run these after every P0/P1 GUI change.

## Shell

- Launch the GUI from `C:\Work\OpencodeX`.
- Drag the app by the titlebar.
- Minimize, maximize/restore, and close from the custom titlebar buttons.
- Relaunch and confirm no orphan sidecar keeps the old GUI data stale.

## Backend Visibility

- In TUI, create or open an existing session in the OpencodeX project.
- Launch GUI with `OPENCODEX_GUI_DIRECTORY=C:\Work\OpencodeX` if not launched from that directory.
- Confirm the GUI dashboard shows the same project and recent session.
- Start work in TUI and confirm GUI updates after the SSE refresh path runs.
- Run `bun run --cwd packages/gui qa:backend-parity` with `OPENCODEX_GUI_QA_URL` pointing at the same backend.

## GUI To TUI Compatibility

- In GUI, create a new project or session.
- Submit a short prompt to the session.
- Open TUI and confirm the same project/session/message is visible.
- Confirm the GUI transcript shows the same message timeline, todos, and file diffs that the TUI production session view shows.

## Primary Actions

- Click `New Project`, choose a folder, and confirm it appears on the dashboard.
- Click `New Session`, enter a title, and confirm the GUI opens the session.
- Click `New Swarm` with at least one project loaded and confirm the swarm count changes.
- Click `New View` with at least one session loaded and confirm the view count changes.

## Safety Regression

- Trigger a permission or question from TUI/backend and confirm GUI shows a blocking panel before the composer can send more prompts.
- Reject a permission from GUI and confirm TUI no longer shows it as pending.
- Answer a question from GUI and confirm TUI/backend no longer shows it as pending.
- Confirm destructive actions are unavailable or confirmation-gated.
- Confirm no provider secrets or auth tokens appear in screenshots or logs.
