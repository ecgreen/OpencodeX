# OpencodeX

OpencodeX is a terminal-native fork of [`opencode`](https://github.com/anomalyco/opencode). It is a **TUI-only** product: there is no web UI, no desktop app, no admin console — just a single, fast, keyboard-driven terminal workspace for running many AI coding conversations at once.

The product direction is documented in [`docs/opencodex.md`](docs/opencodex.md). The short version: a left sidebar for fast conversation switching, a dashboard over every session you've ever started, resumable history shared with upstream `opencode`, concurrent agent instances, and a clear visual signal when a session is dormant, working, or blocked waiting for you.

> Screenshots and animated GIFs will be added at `docs/screenshots/` once the visual pass is complete. The sections below mark where they will land.

## Why a TUI only fork

The upstream `opencode` repository ships a web UI, a desktop wrapper, an admin console, Storybook, and analytics alongside the TUI. OpencodeX keeps the TUI and the supporting libraries it actually depends on, and removes the rest. The fork is built, installed, and run as a single terminal binary on every platform.

What that means in practice:

- `opencodex` is a single binary that runs the TUI.
- A local server (the same one upstream `opencode` uses) runs in-process to back the TUI over a unix socket / named pipe.
- No browser, no Electron, no Vite dev server, no Storybook runner is involved in the install, build, or runtime path.
- Upstream `opencode` session data on disk is read directly so existing history is preserved.

## What you get

- **A persistent conversation sidebar** with live status colors and an animated whip indicator next to the model name when a session is running.
- **A multi-session dashboard** for browsing every dormant, running, and blocked conversation in one place.
- **A project system** that groups conversations under named, multi-folder worktrees so you can keep separate codebases in flight.
- **Resumable sessions** — sessions created by upstream `opencode` are imported as-is; the same session id round-trips between the two CLIs.
- **Concurrent agent instances** with input-needed detection, so blocked sessions jump out of the list.
- **A model picker, provider picker, agent picker, MCP picker, theme picker, skill picker, and command palette** so the entire workflow is keyboard-navigable.
- **The `opencode` plugin and SDK surfaces** are preserved, so community tools keep working.

## The sidebar

The sidebar (`Ctrl+S` to toggle) is the fastest way to move between conversations.

```
┌────────────────────────────────────────┐
│  OpencodeX                  + project  │
│  4 conversations                       │
│ ──────────────────────────────────────│
│  Pinned                                │
│  • Refactor auth layer                 │
│    claude-sonnet-4-5                   │
│  Projects                              │
│  ▾ manifold                            │
│    • Ship input-needed-color fix       │
│      ┊◇◆◇┊  claude-opus-4-5            │   ← in_progress (blue)
│    • Add workspace API                 │
│      gpt-5                             │
│  Sessions                              │
│  • New session - 2025-11-14            │
│  Ctrl+S toggle                         │
└────────────────────────────────────────┘
```

The dot to the left of each row is the session status:

- **gray** — `dormant` (idle, no agent running)
- **blue** — `in_progress` (an agent is producing output)
- **orange** — `input_needed` (a permission or question is waiting for you)

The status color is applied to both the title row and the model-name sub-row so you can see at a glance which session needs attention, even when it is the currently selected row.

When a session is `in_progress` and animations are enabled (`animations_enabled` KV, default `true`), a narrow whip animation (4-cell "diamonds" style) is rendered next to the model name. Width 4 keeps the spinner readable inside the 36-column sidebar without truncating the model label. With animations disabled, the spinner falls back to a static `⋯` glyph in the same blue.

> Screenshot placeholder: `docs/screenshots/sidebar-running.png`
>
> Screenshot placeholder: `docs/screenshots/sidebar-input-needed.png`

## The dashboard

The home screen (`o` from anywhere, or the first screen you see on launch) lists every conversation in the current project, grouped by recency and status. Each row shows the same status dot as the sidebar, plus a one-line preview of the last user message.

The dashboard and the sidebar share the same data source (`@opencode-ai/core` + the local server) so they stay in sync without manual refresh.

> Screenshot placeholder: `docs/screenshots/dashboard.png`

## Project system

A project is a named group of folders that share a session pool. The intent is to keep separate codebases from mixing their history while still being able to attach a conversation to multiple folders at once.

- `+ project` in the sidebar header creates a new project.
- `✎` on a project row edits its name and folder list (semicolon- or newline-separated).
- `+` on a project row opens a fresh session bound to that project; the session is created in the project home and its working directory is set to the project root.
- A "Move Session" action in the Manage Sessions dialog re-binds a conversation to a different project.
- Deleting a project does **not** delete its sessions — they move into the unassigned list and remain resumable.

> Screenshot placeholder: `docs/screenshots/project-create.png`

## Resume and import

Sessions created by upstream `opencode` are picked up automatically. The TUI reads the same `.opencode` storage on disk that upstream uses, so the same session id is recognized in both. Switching back to upstream `opencode` keeps your history.

## Concurrent agents

Multiple agent instances can be running at the same time. Each running session has its own status row, its own status color, and its own whip animation. When a session is blocked waiting for a permission grant or a user question, it flips to orange and the dot prefix changes; pressing `Enter` on a blocked session jumps straight to its prompt so you can answer.

## The prompt and whip animation

The prompt area (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`) uses a per-agent whip animation built from `createFrames({ color, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 })` in `packages/opencode/src/cli/cmd/tui/ui/spinner.ts`. The spinner colors itself from the active agent's color and runs at 40 ms per frame. With `animations_enabled = false`, it falls back to a static `[⋯]` glyph.

> Screenshot placeholder: `docs/screenshots/prompt-whip.png`

The sidebar's new model-name spinner reuses the same primitives with a narrower width (4) and a "diamonds" style so the visual weight matches a sidebar row rather than a prompt footer.

## Keybindings

The default keybindings follow the upstream `opencode` TUI:

| Key | Action |
| --- | --- |
| `Ctrl+S` | Toggle the sidebar |
| `Enter` | Resume the selected session (or jump to its prompt if blocked) |
| `n` | New session in the current project |
| `Esc` | Cancel the current input or dismiss a dialog |
| `Tab` / `Shift+Tab` | Cycle through the prompt, sidebar, and dashboard |
| `o` | Open the dashboard |
| `Ctrl+P` | Open the command palette |
| `Ctrl+L` | Cycle the theme |
| `q` | Quit (with confirmation if any session is running) |

> The command palette is the authoritative source for the full keymap.

## Install

OpencodeX is built and installed from source. There is no npm / brew / winget release pipeline yet — that is intentional, the fork is currently internal.

### Windows (from WSL — recommended)

The build is cross-compiled from WSL to a Windows `.exe` so you can install on the Windows side without leaving Linux. Output lands in `artifacts/`.

```bash
bash build.sh                          # default: win32-x64-baseline
bash build.sh --target win32-x64       # AVX2-capable machines
bash build.sh --target win32-arm64     # Windows on ARM
bash build.sh --clean                  # wipe the /tmp build dir first
```

Then from PowerShell:

```powershell
pwsh -File .\build-and-install.ps1
```

`build-and-install.ps1` reads the artifact that `build.sh` produced, copies it to `$env:LOCALAPPDATA\OpencodeX\opencodex.exe`, and adds that directory to the user `PATH`. The `install-windows.ps1` script does the same with no build step, useful for restoring from a known artifact.

### Linux / macOS

```bash
bash build.sh --target linux-x64         # or darwin-arm64, darwin-x64, …
sudo cp artifacts/opencodex-linux-x64 /usr/local/bin/opencodex
```

## First command

```bash
opencodex
```

`opencodex` opens the persistent conversation dashboard. Use `j` / `k` (or arrow keys) to choose a conversation, `Enter` to resume it, `n` for a new session, `Ctrl+S` for the sidebar, `q` to quit.

For scripting, the dashboard is also exposed as JSON:

```bash
opencodex dashboard --format json
```

## Development

This repo follows upstream `opencode`'s Bun workspace setup.

```bash
bun install                              # install all workspace deps
bun run --cwd packages/opencode typecheck
bun dev                                  # TUI in dev mode (auto-reload on file change)
```

The TUI's only runtime dependency on the workspace is:

- `@opencode-ai/core` — the agent runtime
- `@opencode-ai/sdk` — the typed client the TUI uses to talk to the local server
- `@opencode-ai/ui` — the shared component library
- `@opencode-ai/llm`, `@opencode-ai/plugin`, `@opencode-ai/script`, `@opencode-ai/http-recorder` — supporting libraries

Everything that is not on that list (web UI, desktop wrapper, admin console, Storybook, analytics) has been removed from this fork.

### Lint and typecheck

Per the project rules, the assistant does not run `bun typecheck`, `tsc`, or lint in this environment. Run them yourself in WSL before sending work for review.

```bash
bun run --cwd packages/opencode typecheck
```

## Package layout

```
.
├── packages/
│   ├── opencode/          # the TUI (the product)
│   ├── core/              # agent runtime
│   ├── sdk/               # typed client (HTTP + websocket)
│   ├── ui/                # shared TUI components
│   ├── llm/               # LLM provider adapters
│   ├── plugin/            # plugin runtime
│   ├── script/            # build & release scripts
│   ├── http-recorder/     # HTTP recording for replays
│   ├── containers/        # container orchestration
│   ├── extensions/        # editor integration adapters
│   ├── identity/          # identity / auth helpers
│   ├── function/          # function-calling utilities
│   ├── enterprise/        # enterprise feature flags
│   ├── slack/             # slack integration
│   ├── effect-sqlite-node/      # sqlite-on-node effect
│   ├── effect-drizzle-sqlite/   # drizzle-on-sqlite effect
│   ├── cli/               # command-line tools
│   └── docs/              # in-repo docs site
├── docs/opencodex.md      # product direction
├── build.sh               # cross-platform build (run from WSL for Windows)
├── build-and-install.ps1  # install the built binary to $env:LOCALAPPDATA
└── install-windows.ps1    # install from a prebuilt artifact
```

The TUI is built and shipped as a single binary. None of the other packages in this list are bundled into the user's install — they exist to support the TUI build and to be importable by community tools.

## Contributing

1. Branch from `main`.
2. Make your change. Run `bun run --cwd packages/opencode typecheck` in WSL before opening a PR.
3. If you are adding a TUI feature, prefer the components in `packages/ui` so other parts of the TUI can reuse them.
4. If you are adding a new keybinding, register it through the keybind registry used by the command palette so it is discoverable.
5. Open a PR. Use the commit scopes `tui`, `opencode`, `sdk`, `ui`, `core`, `llm`, `plugin`, `script`, `docs`, or `infra` as appropriate.

## License

Same license as upstream `opencode` — see [`LICENSE`](LICENSE).
