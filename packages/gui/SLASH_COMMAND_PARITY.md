# GUI Slash Command Parity

This note tracks TUI slash commands that were present in the GUI menu but did not yet have a GUI implementation.

## Current GUI status

Implemented in this pass:

- `/share`, `/unshare`, `/compact`, `/undo`, `/redo`, `/fork`, `/copy`, `/export`
- `/mcps`, `/org`, `/connect`, `/workspaces`, `/warp`
- `/edit-view`, `/delete-view`, `/timeline`, `/timestamps`, `/thinking`, `/skills`, `/swarm`
- `/diff`, `/themes`, `/editor`

## Backend-backed session commands

- `/share`: TUI copies an existing `session.share.url` or calls `session.share({ sessionID })`, then copies the returned URL. GUI plan: call the same backend method, copy with `navigator.clipboard`, refresh cards.
- `/unshare`: TUI calls `session.unshare({ sessionID })`. GUI plan: call the same backend method, then refresh cards.
- `/compact` (`/summarize`): TUI requires the current model and calls `session.summarize({ sessionID, providerID, modelID })`. GUI plan: parse the selected GUI model and call the same backend method.
- `/undo`: TUI aborts active work if needed, finds the previous user message, calls `session.revert({ sessionID, messageID })`, and restores the reverted prompt text/files into the prompt. GUI plan: call the same backend method and restore text into the main composer when available.
- `/redo`: TUI calls `session.unrevert` when there is no later user message, otherwise calls `session.revert` to advance the revert marker. GUI plan: mirror that behavior with loaded message data.
- `/fork`: TUI opens a timeline picker and calls `session.fork({ sessionID, messageID? })`, then navigates to the forked session. GUI plan: use the existing choice dialog over loaded user messages plus a full-session option.
- `/copy`: TUI formats the session transcript with `formatTranscript(...)` and copies it. GUI plan: format the loaded session bundle in GUI code and copy it.
- `/export`: TUI formats the transcript and writes/opens a file through filesystem/editor helpers. GUI plan: generate a Markdown download from the browser.

## Backend-backed global/provider commands

- `/mcps`: TUI reads `mcp.status()`, toggles with `mcp.connect({ name })` or `mcp.disconnect({ name })`, then refreshes status. GUI plan: load status on demand, choose one MCP, toggle it, then refresh.
- `/org`: TUI calls `experimental.console.listOrgs()`, then `experimental.console.switchOrg({ accountID, orgID })`, and disposes the backend instance. GUI plan: same list/switch flow, then refresh GUI snapshot.
- `/connect`: TUI reads `provider.list()` and `provider.auth()`, supports provider-specific prompts, OAuth authorize/callback, and `auth.set` for API-key providers; it disposes the backend instance and opens model selection. GUI implementation now supports provider/custom-provider selection, API-key credentials, auth prompts, OAuth code/auto callback handoff, backend instance disposal, and snapshot refresh. Follow-up: open model picker automatically after successful connection.
- `/workspaces`: TUI syncs/list workspaces, shows status, details, and delete. GUI implementation now syncs/lists/statuses workspaces and removes a selected workspace after confirmation. Follow-up: add workspace creation/adapters and richer details.
- `/warp`: TUI chooses none/new/existing workspace, optionally copies file changes, calls `experimental.workspace.warp({ id, sessionID, copyChanges })`, sends a synthetic directory reminder, then refreshes workspace/session state. GUI implementation now supports local-project detach or existing workspace warp with copy-changes choice. Follow-up: new workspace adapters and the synthetic reminder prompt.

## GUI-surface commands

- `/edit-view`: TUI picks or loads a view, edits title/session selections, then PATCHes `/experimental/opencodex/view/:id`. GUI plan: add a simpler edit dialog using existing GUI view/session data.
- `/delete-view`: TUI picks a view, confirms, then DELETEs `/experimental/opencodex/view/:id`. GUI plan: same backend call through the existing GUI dialog primitives.
- `/timeline`: TUI lists user messages and previews the selected message while moving the scroll position. GUI plan: choose a user message and scroll the transcript to it.
- `/diff`: TUI navigates to a diff viewer route backed by `session.diff({ sessionID })` for last-turn diffs and `vcs.diff({ mode: "git", context: 12 })` for working-tree diffs, with file tree, split/unified view, source switching, and reviewed markers persisted through session UI state. GUI implementation now adds a diff route with the same two backend sources, file picker, split/unified toggle, source switching, refresh, and reviewed-file persistence for last-turn session diffs.
- `/themes`: TUI previews and commits themes through its theme context. GUI implementation now supports the requested dark/light modes with a `/themes` picker and persisted root `data-theme`.
- `/editor`: TUI opens `$EDITOR`, reads edited content back into the prompt, and remaps prompt parts. GUI implementation now adds an Electron main/preload bridge that writes the current composer text to a temp Markdown file, spawns `$VISUAL` or `$EDITOR`, reads the edited content back, and restores it into the composer. Follow-up: prompt-part rehydration for non-text virtual parts, matching the deeper TUI behavior.
- `/skills`: TUI opens a skill picker from `app.skills()` and inserts `/<skill> ` into the prompt. GUI implementation now calls `app.skills()` and fills the composer draft.
- `/swarm`: TUI opens a swarm task picker, collects a prompt, then POSTs `/experimental/opencodex/swarm/:id/task` with prompt, agent, mode, and variant. GUI implementation now chooses an active swarm, collects the task prompt, and calls the same task endpoint with prompt plus available agent/variant.
