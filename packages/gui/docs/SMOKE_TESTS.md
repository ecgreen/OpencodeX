# GUI Smoke Tests

Run these after every P0/P1 GUI change.

## Automated rendered smoke

Install Chromium once, then run the GUI against a real isolated OpencodeX backend:

```bash
cd packages/gui
bunx playwright install chromium
bun run test:e2e
```

The test renders the dashboard in Chromium, navigates between Dashboard and Swarms, fails on browser errors, captures a screenshot, and proves that an idle client does not periodically request the legacy session snapshot or authoritative root snapshot. Runtime data, traces, videos, screenshots, and the CI JUnit report live under `packages/gui/.artifacts/e2e`.

For interactive debugging, use `bun run test:e2e:headed`. The full TUI is rendered through OpenTUI's test renderer by `packages/opencode/test/cli/tui/app-lifecycle.test.ts`; its smoke contract verifies the dashboard frame and the same idle no-poll invariant.

## Automated Electron acceptance

Run the compiled main/preload boundary, real native views, and an isolated sidecar against a disposable Git workspace:

```bash
cd packages/gui
bun run test:e2e:electron
```

This covers the sandboxed preload bridge, folder/context dialogs, titlebar edit and window controls, exact file save, stage/commit, embedded-browser bounds/screenshot/navigation, a real PTY command, and clean shutdown. Runtime data and traces live under `packages/gui/.artifacts/e2e-electron`. The operating-system dialog result is stubbed in Electron main-process test scope; renderer buttons and all production IPC handlers remain real.

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

## Keyboard Navigation

- Press `Ctrl+K`, search for a session, project, and view, and confirm each result opens directly.
- Press and hold `Ctrl+Tab`, cycle through recent sessions, and confirm releasing `Ctrl` opens the highlighted session.
- Press `Alt+1` through `Alt+9` and confirm each available shortcut opens the corresponding recent session.
- Open keyboard help with `Ctrl+?` and confirm its filter, close button, and shortcut labels are keyboard accessible.

## Session Workspace

- Open the session side panel and confirm Git data loads only while its Git tab is active.
- Open a terminal tab, switch between light and dark themes, and confirm the terminal palette updates with the app.
- Add enough side-panel tabs to overflow, resize the panel, and confirm tabs remain selectable without duplicate hidden controls in the accessibility tree.
- Scroll more than 200px above the transcript bottom, receive new content, and confirm the viewport does not jump; then return near the bottom and confirm following resumes.
- Trigger a running session, press `Escape` twice within the confirmation window, and confirm the first press warns while the second aborts.

## Views

- Search views by view, project, session, and status text; clear the search and confirm the original order returns.
- Reorder selected panes with the up/down controls, save, reopen the view, and confirm pane order is preserved.
- Resize an active multi-pane view from desktop width to a narrow window and confirm each pane retains one intentional scroll owner.

## Safety Regression

- Trigger a permission or question from TUI/backend and confirm GUI shows a blocking panel before the composer can send more prompts.
- Reject a permission from GUI and confirm TUI no longer shows it as pending.
- Answer a question from GUI and confirm TUI/backend no longer shows it as pending.
- Confirm destructive actions are unavailable or confirmation-gated.
- Confirm no provider secrets or auth tokens appear in screenshots or logs.
