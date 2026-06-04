# OpencodeX GUI Parity Map

This package is intentionally frontend-only. It must preserve TUI compatibility by using the existing `opencodex serve` API surface and generated `@opencode-ai/sdk/v2` client.

## First Slice

- Electron desktop shell for Windows, macOS, and Linux.
- Local authenticated sidecar launcher with Electron-side auth header injection.
- Live dashboard using existing projects, sessions, jobs, swarms, and views endpoints.
- Session transcript view and async prompt submission through existing session APIs.
- SSE subscription with refresh-on-event behavior.

## Required TUI Parity Areas

- App shell, keyboard navigation, command palette, dialogs, themes, help, and settings.
- Prompt composer with shell mode, slash commands, drafts, history, stash, attachments, editor context, and interrupt.
- Session transcript with tool parts, todos, diffs, permissions, questions, timeline, fork, compact, share, export, undo, and scroll controls.
- OpencodeX project management, project-scoped sessions, moving/deleting sessions, pinning, and folder validation.
- Operations dashboard for projects, attention needed, recent sessions, swarms, and views.
- Swarm create/edit/start/cancel/task workflows with role model/provider/agent/skill configuration.
- Multi-session views with 1-8 panes, focused pane persistence, and prompt targeting.
- Provider/model/agent/variant selectors, MCP/resource/LSP/formatter/VCS status, and auth flows.
- Plugin routes and extension points where TUI supports them.

## Compatibility Rules

- Do not modify backend routes, schemas, migrations, or storage formats for GUI work.
- Do not access SQLite directly from the GUI.
- Treat `/experimental/opencodex/*` as the source of truth for OpencodeX data until the backend graduates the API.
- GUI-owned persistence is limited to disposable UI state such as window bounds and non-authoritative preferences.
- Any GUI-created project, session, swarm, or view must remain usable from the TUI.

## Release Gates

- GUI typecheck and packaged smoke test for sidecar startup.
- Dashboard/session smoke against a temporary workspace.
- TUI/GUI compatibility smoke: create in one client, read/use in the other.
- Permission/question safety tests before enabling write-heavy workflows broadly.
- Cross-platform packaging smoke for Windows x64/ARM64, macOS arm64, and Ubuntu x64.

## Sidecar Packaging

Packaged builds require `resources/sidecar/opencode` or `resources/sidecar/opencode.exe`. Generate it before `electron-builder` with:

```sh
bun run --cwd packages/opencode build --single --skip-embed-web-ui
bun run --cwd packages/gui prepare:sidecar
```

Set `OPENCODEX_GUI_SIDECAR_TARGET` when packaging a non-native target, for example `opencode-windows-x64` or `opencode-darwin-arm64`.

## Windows Local Install

Use `bun run --cwd packages/gui install:local:win` to install and launch the local NSIS build. The packaged GUI executable is named `opencodex-gui.exe` on Windows to avoid colliding with TUI/CLI process names. The install script only stops installed GUI executables by full path. Do not use broad process-name commands such as `Stop-Process -Name OpencodeX`, because that can match and disrupt a running OpencodeX TUI/CLI session.
