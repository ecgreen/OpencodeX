# GUI Parity Cards

These cards are the working backlog for matching the OpencodeX TUI. QA should validate each card against the TUI behavior and file issues using `docs/QA_ISSUE_TEMPLATE.md`.

## P0-1 App And Window Shell

Acceptance criteria:
- Window can be moved, minimized, maximized, and closed on Windows, macOS, and Linux.
- Sidecar startup shows recoverable errors and retry path.
- Navigation exposes Dashboard, Sessions, Projects, Swarms, Views, Settings, and Status.
- External links open with the OS browser, not a new Electron window.

TUI references:
- `packages/opencode/src/cli/cmd/tui/app.tsx`
- `packages/opencode/src/cli/cmd/tui/context/route.tsx`
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`

## P0-2 Backend Data Compatibility

Acceptance criteria:
- GUI opens against the same directory/project data as TUI.
- Existing TUI-created sessions, projects, swarms, jobs, and views appear in GUI.
- GUI-created records remain visible and usable from TUI.
- Live work updates from SSE without requiring app restart.

TUI references:
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar.tsx`
- `packages/opencode/src/cli/cmd/tui/component/opencodex-operations.tsx`

## P0-3 Project And Session Actions

Acceptance criteria:
- User can create a project with folder validation.
- User can create sessions globally and inside a project.
- User can rename, delete, move, and open sessions.
- Destructive actions require confirmation.

TUI references:
- `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-session-rename.tsx`
- `packages/opencode/src/cli/cmd/tui/ui/dialog-folder-picker.tsx`

## P0-4 Session Chat And Ongoing Work

Acceptance criteria:
- Session transcript renders user, assistant, reasoning, file, tool, todo, error, and unknown parts.
- Transcript data follows the production TUI path: `session.messages`, `session.todo`, and `session.diff`. The TUI v2 session route is currently a debug route and should not replace the main GUI transcript until it becomes production TUI behavior.
- Prompt submission targets the selected session and updates live.
- Busy sessions expose interrupt/abort.
- Long transcripts and tool output remain usable.

TUI references:
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- `packages/opencode/src/cli/cmd/tui/util/collapse-tool-output.ts`

## P0-5 Permissions And Questions

Acceptance criteria:
- Permission requests are visible immediately and clearly block unsafe continuation.
- User can approve once, always allow with confirmation, reject, and inspect metadata/tool context.
- Question prompts support single choice, multi choice, reply, and reject.
- Dashboard marks sessions that need input.

TUI references:
- `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/question.tsx`

## P1-6 Prompt Composer Parity

Acceptance criteria:
- Composer supports normal mode, shell mode, slash commands, history, drafts, stash, clear, and attachments.
- Prompt context can include files, editor context, and agent/subtask parts where backend supports them.
- Drafts are scoped by session or view pane.

TUI references:
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/drafts.tsx`

## P1-7 Model, Provider, Agent, Variant Controls

Acceptance criteria:
- User can inspect provider auth state and select model, provider, agent, and variant.
- Selection is used for prompt submission and swarm roles.
- MCP, LSP, formatter, VCS, and provider status surfaces exist.

TUI references:
- `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-mcp.tsx`
- `packages/opencode/src/cli/cmd/tui/component/dialog-status.tsx`

## P1-8 Swarm Lifecycle

Acceptance criteria:
- User can list, create, edit, start, cancel, and assign tasks to swarms.
- Role instructions, agent, skill, provider, model, and profile are preserved.
- Role sessions and run events are visible and linked.

TUI references:
- `packages/opencode/src/cli/cmd/tui/component/opencodex-operations.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

## P1-9 Multi-Session Views

Acceptance criteria:
- User can list, create, edit, delete, reorder, and open views.
- Open view renders 1-8 sessions with focused pane persistence.
- Prompting targets only the focused pane.

TUI references:
- `packages/opencode/src/cli/cmd/tui/component/opencodex-views.tsx`
- `packages/opencode/src/cli/cmd/tui/component/opencodex-view-dialog.tsx`

## P2-10 Session Power Tools

Acceptance criteria:
- Session actions include timeline, fork, compact, share/unshare, export, copy, undo/redo, diff preview, and delete.
- Timestamps, thinking visibility, tool detail visibility, and scroll controls are available.

TUI references:
- `packages/opencode/src/cli/cmd/tui/routes/session/dialog-timeline.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/dialog-fork-from-timeline.tsx`
- `packages/opencode/src/cli/cmd/tui/util/transcript.ts`

## P2-11 Command Palette, Settings, Plugins

Acceptance criteria:
- Command palette exposes common global/session actions.
- Settings expose theme, status, docs, debug, and safe GUI preferences.
- Plugin route support has an explicit implemented or unsupported state.

TUI references:
- `packages/opencode/src/cli/cmd/tui/component/command-palette.tsx`
- `packages/opencode/src/cli/cmd/tui/ui/dialog-help.tsx`
- `packages/opencode/src/cli/cmd/tui/plugin/*`
