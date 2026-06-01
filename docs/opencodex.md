# OpencodeX Direction

OpencodeX is now a terminal-native fork of upstream `opencode`, not a VS Code extension.

The product goal is Codex-style orchestration inside the terminal:

- A high-level dashboard for all current and previous conversations.
- A left sidebar for fast conversation switching.
- Resume existing upstream `opencode` conversations from their stored session IDs.
- Run multiple agent instances at once and surface which ones are active, done, blocked, or waiting for feedback.
- Jump directly into a task when it needs input.
- Keep upstream `opencode` compatibility where it helps users migrate existing history.

## Current Cleanup

- The failed VS Code plugin has been removed from the active project path.
- This repository is a fresh checkout of `https://github.com/anomalyco/opencode`.
- The CLI now exposes an `opencodex` bin alias alongside `opencode`.
- `opencodex` opens a persistent high-level conversation dashboard by default.
- `opencodex dashboard --format json` exposes the same persistent session state for scripting.

## Implementation Path

1. Move the current keyboard dashboard into an OpenTUI split view with a true persistent sidebar.
2. Add process tracking for live OpencodeX agent instances.
3. Add attach/resume actions for previous `opencode` sessions without leaving the dashboard process.
4. Add blocked/input-needed detection from question, permission, and session status events.
5. Rebrand packaging, release artifacts, and install scripts after the fork behavior is stable.
