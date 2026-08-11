# OpencodeX — Developer Guide

This is the developer-side companion to the user-facing [`README.md`](README.md). If you just want to run OpencodeX, start there. If you want to build it, change it, debug it, or release a new version, you're in the right place.

OpencodeX is a Bun workspace monorepo built on top of [opencode](https://github.com/anomalyco/opencode). The primary product is the terminal client — the CLI and its TUI. A second, public-preview client (the Electron GUI in `packages/gui`) runs against the same backend; unless a section says otherwise, everything below is about the terminal client.

## Table of contents

- [Prerequisites](#prerequisites)
- [Repo layout](#repo-layout)
- [Quickstart by platform](#quickstart-by-platform)
  - [Linux](#linux)
  - [macOS](#macos)
  - [Windows (via WSL)](#windows-via-wsl)
- [Day-to-day dev workflow](#day-to-day-dev-workflow)
- [Linting and typechecking](#linting-and-typechecking)
- [Testing](#testing)
- [Building a single binary](#building-a-single-binary)
  - [`build.sh` (cross-platform, from WSL or Linux/macOS)](#buildsh-cross-platform-from-wsl-or-linuxmacos)
  - [`build-and-install.ps1` (Windows one-shot)](#build-and-installps1-windows-one-shot)
  - [`install-windows.ps1` (Windows, prebuilt artifact)](#install-windowsps1-windows-prebuilt-artifact)
- [CLI name resolution (`opencode` vs `opencodex`)](#cli-name-resolution-opencode-vs-opencodex)
- [Adding code to the right place](#adding-code-to-the-right-place)
- [Debugging](#debugging)
- [Releasing](#releasing)
- [Upstream merge workflow](#upstream-merge-workflow)
- [Troubleshooting](#troubleshooting)

## Prerequisites

You need:

- **Bun 1.3+** — the version pinned in the root `package.json` is the one this repo expects (`packageManager: "bun@1.3.14"`). Install with `curl -fsSL https://bun.sh/install | bash`.
- **Git** — obviously.
- **`rsync`** — `build.sh` uses it to mirror the source into a build dir. Linux/macOS/WSL all have it. On macOS it ships with Xcode Command Line Tools.
- **WSL 2** — required for the Windows build path. See the [Windows section](#windows-via-wsl).
- **PowerShell 7+** — for the Windows install scripts. `pwsh -Version` should report `7.x` or higher. Windows 10/11 usually ship with `powershell.exe` 5.1; install `pwsh` from the Microsoft Store or `winget install Microsoft.PowerShell`.

That's the entire list for the terminal client: no Docker, no Postgres, no dev server, no Storybook — the TUI runs against an in-process server. The GUI preview adds two of its own: Vite (`bun dev:electron`, wired up inside `packages/gui`) and, only for the containerised end-to-end suite, Docker via `compose.gui-e2e.yaml`. Neither is needed to build or run the TUI.

## Repo layout

There are eleven workspaces, all of them declared in the root `package.json` and enforced by
`bun run surface:audit`. If a directory is not in that list, it is not a workspace.

```
.
├── packages/
│   ├── opencode/                # the CLI + TUI (the product)
│   ├── core/                    # agent runtime, SQLite schema, migrations
│   ├── gui/                     # Electron desktop GUI (public preview)
│   ├── sdk/js/                  # generated typed client (HTTP + websocket)
│   ├── ui/                      # shared Solid components + notification audio
│   ├── llm/                     # LLM provider adapters and routing
│   ├── plugin/                  # plugin runtime + public plugin types
│   ├── script/                  # shared release metadata (channel, version, team)
│   ├── effect-drizzle-sqlite/   # drizzle-on-sqlite Effect integration
│   └── http-recorder/           # HTTP recording for replay tests
├── github/                  # the published GitHub Action (its own workspace)
├── docs/                    # ARCHITECTURE, UPSTREAM, GITHUB, PUBLIC_PREVIEW, opencodex
├── upstream/                # upstream pin (lock.json) + retained-surface policy
├── script/                  # repo-level scripts (lint baseline, upstream status, dev launcher)
├── .github/workflows/       # ci, release-cli, release-gui, upstream-status, upstream-sync
├── .opencode/               # self-hosted opencode config (used to develop opencodex)
├── build.sh                 # cross-platform build (run from WSL for Windows)
├── build-and-install.ps1    # WSL build + Windows install, one shot
├── install-windows.ps1      # Windows installer (also uploaded to every release)
├── install                  # this fork's POSIX installer (also uploaded to every release)
└── opencodex, opencodex.cmd # repo-local launcher shims
```

Two directories are easy to overlook and are the largest fork-owned surfaces after
`packages/opencode`: **`packages/gui`** (the Electron preview, with its own docs under
`packages/gui/docs/`) and **`github/`** (the published Action, documented in
[`docs/GITHUB.md`](docs/GITHUB.md)).

`install` is **this fork's** installer, not an upstream leftover: `release-cli.yml` copies it into
every GitHub Release, which is what `curl -fsSL .../releases/latest/download/install | bash`
downloads. Do not delete it.

The build scripts (`build.sh`, `build-and-install.ps1`, `install-windows.ps1`) live at the repo root
so they can be invoked from a developer shell that is not inside any one workspace.

## Quickstart by platform

### Linux

```bash
git clone https://github.com/ecgreen/OpencodeX.git
cd opencodex
bun install
bun dev
```

`bun dev` is the local equivalent of the built `opencode` binary. It launches the TUI against the working directory it is invoked from, or you can pass a directory:

```bash
bun dev                      # TUI in the current dir
bun dev ~/code/myproject     # TUI in another repo
bun dev .                    # TUI in the repo root (handy when iterating on opencodex itself)
```

To run the headless server only (no TUI), useful for SDK experimentation:

```bash
bun dev serve                # default port 4096
bun dev serve --port 8080
```

You can also `cd packages/opencode && bun run dev` if you prefer the workspace-local form — they are equivalent.

### macOS

```bash
git clone https://github.com/ecgreen/OpencodeX.git
cd opencodex
bun install
bun dev
```

That's the whole flow. `bun dev` will pick the right native binary for your arch (Apple Silicon vs Intel) automatically through the same `bin/opencode` shim that ships with the published CLI.

### Windows (via WSL)

OpencodeX is developed and built on Windows **through WSL 2**. The TUI itself can be built and run as a Windows `.exe`, but the build pipeline is Linux-based, so you always go through WSL for the build step.

One-time WSL setup:

```powershell
# In an elevated PowerShell
wsl --install
# Reboot if prompted
wsl --set-default-version 2
# Install Ubuntu (or any distro) from the Microsoft Store, then:
wsl
```

Inside WSL, install Bun and clone:

```bash
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/ecgreen/OpencodeX.git
cd opencodex
bun install
bun dev
```

If you want to iterate on the TUI from a normal Windows terminal and then run the result on Windows itself, the two PowerShell scripts in the repo handle the whole pipeline:

```powershell
# From the repo root, in Windows PowerShell or pwsh
pwsh -File .\build-and-install.ps1
```

That single command:

1. Detects WSL and converts your repo path to its WSL mount.
2. Cross-compiles the Windows binary inside WSL (defaults to `win32-x64-baseline`).
3. Copies the artifact to `%LOCALAPPDATA%\Programs\OpencodeX\opencodex.exe` and adds that directory to your user `PATH`.
4. Runs `--version` to confirm the install.

After that, restart your terminal and `opencodex` is on your `PATH`. The same `opencodex` runs the TUI against whatever directory you `cd` into first, identical to the Linux/macOS flow.

If you already have a prebuilt artifact (for example, one a teammate shared in `artifacts/`), skip the WSL build step:

```powershell
.\install-windows.ps1 -ArtifactPath .\artifacts\opencodex-windows-x64-baseline.zip
```

To uninstall later:

```powershell
.\install-windows.ps1 -Uninstall
```

The rest of this guide assumes you can run `bun` and the build scripts from your platform of choice.

## Day-to-day dev workflow

Most days look like this:

1. `git pull` and `git checkout main` (the default branch is `main`; see [Upstream merge workflow](#upstream-merge-workflow)).
2. `bun install` — only needed if `bun.lock` or a `package.json` changed.
3. `bun dev` (or `bun dev <directory>`).
4. Edit code. `bun dev` hot-reloads.
5. Before pushing, run `bun run typecheck`, `bun run lint:ci`, and `bun run surface:audit` — see the [next section](#linting-and-typechecking).

Common patterns:

- **Edit the TUI**: change files under `packages/opencode/src/cli/cmd/tui/`, save, and `bun dev` will pick them up. TUI widgets are OpenTUI/Solid components local to that tree; `packages/ui` is the Solid component library shared with the **GUI** (plus the notification audio the TUI imports), not a TUI widget kit.
- **Edit a keybinding**: register it in `packages/opencode/src/cli/cmd/tui/config/keybind-definitions.ts` (the `keybind(...)` table plus the action-id map at the bottom of the file) so it is discoverable in the command palette (`Ctrl+P`). `keybind.ts` alongside it resolves and merges those definitions.
- **Edit the agent runtime**: most runtime logic lives in `packages/core/`. The TUI and GUI talk to it through the generated SDK in `packages/sdk/js/`.
- **Add a new provider or model**: providers are loaded from `models.dev`, not from this repo. Add the model upstream first, then it will appear in the TUI on the next fetch.
- **Add a new TUI feature under `opencodex`**: the new code lives under `packages/opencode/src/opencodex/`. The HTTP surface goes in `packages/opencode/src/server/routes/instance/httpapi/groups/opencodex.ts` and `handlers/opencodex.ts`. The sidebar component is `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar.tsx` — see [`docs/UPSTREAM.md`](docs/UPSTREAM.md) for the fork's upstream-seam and sync policy.

## Linting and typechecking

Two conventions from `AGENTS.md` matter here:

- The default branch is `main`. Use `main` / `origin/main` as the base for diffs and pull requests.
- Tests cannot be run from the repo root; they are guarded against it. Always `cd packages/opencode` (or whatever package the test lives in) first.

The relevant commands:

```bash
# TypeScript across the whole workspace (turbo fan-out)
bun run typecheck

# TypeScript for the TUI package only (fastest loop)
bun run --cwd packages/opencode typecheck

# Linter (raw oxlint; reports the full warning set)
bun run lint

# Linter as CI runs it — compares against .oxlint-baseline.json and fails only on regressions
bun run lint:ci

# Lint or auto-fix a single file
bunx oxlint <path>
bunx oxlint --fix <path>
```

`lint:ci` is the gate that matters. The repo carries a large baselined warning count in
`.oxlint-baseline.json`; `bun run lint` printing warnings is expected, `bun run lint:ci` failing is not.

Two structural checks run in CI and are worth running locally when you move files around:

```bash
bun run surface:audit      # workspace/catalog/pruned-path policy in upstream/policy.json
bun run check:client-state # GUI client-state boundary
```

If you changed `packages/opencode/src/server/server.ts` or anything in the SDK, regenerate the JS SDK before running typecheck:

```bash
./packages/sdk/js/script/build.ts
```

## Testing

Tests live in `packages/opencode/test/`, organised by subsystem (`agent/`, `session/`, `provider/`, `opencodex/`, etc.). They run with `bun test`.

```bash
# Unit tests for the TUI package
cd packages/opencode
bun test                              # all tests
bun test test/opencodex               # just the OpencodeX tests
bun test test/session                 # just the session tests

# JUnit output (CI mode)
bun run test:ci
# -> .artifacts/unit/junit.xml

# HTTP API exercise
bun run test:httpapi
```

The GUI has its own suite:

```bash
cd packages/gui
bun test                # unit + logic tests
bun run qa              # typecheck + tests + design-system + package checks
bun run test:e2e        # Playwright end-to-end (needs a built renderer)
```

Everything at once, the way CI runs it, from the repo root:

```bash
bun run test:ci         # CI-task check + client-state boundary + turbo test:ci across workspaces
```

Notes:

- Tests are guarded at the repo root — running `bun test` from there will refuse to run. Always `cd` into the package first. (`bun run test:ci` from the root is fine; it fans out through turbo.)
- `test:httpapi` runs the API surface through a coverage + auth + effect cycle and fails the run on missing or skipped cases. It is the closest thing to an integration test we have.
- If you want to profile a slow test, `bun run profile:test` will help. `bun run bench:test` runs the test suite in benchmark mode.

## Building a single binary

There are three build paths. Pick the one that matches what you are trying to do.

### `build.sh` (cross-platform, from WSL or Linux/macOS)

`build.sh` is the cross-platform build script. It runs on any Unix-like system and produces a single binary for the target you pass it. When run from WSL, it can produce Windows binaries.

```bash
# Default: Windows x64 baseline (the most compatible Windows build)
bash build.sh

# Specific targets
bash build.sh --target win32-x64          # Windows x64 (AVX2)
bash build.sh --target win32-x64-baseline  # Windows x64 (no AVX2, broadest compat)
bash build.sh --target win32-arm64         # Windows on ARM
bash build.sh --target linux-x64           # Linux x64
bash build.sh --target linux-x64-baseline  # Linux x64 (no AVX2)
bash build.sh --target darwin-arm64        # macOS Apple Silicon
bash build.sh --target darwin-x64          # macOS Intel

# Optional flags
bash build.sh --minify   # enable minification (off by default to avoid Bun compile quirks)
bash build.sh --clean    # wipe the /tmp/OpencodeX build dir first
bash build.sh --help     # full help
```

The script:

1. Verifies `bun` and `rsync` are installed.
2. Mirrors the source from the repo root to `/tmp/OpencodeX` (working around WSL's virtiofs symlink limitations — building inside `/mnt/c/` is unreliable on WSL).
3. Runs `bun install` in the mirror.
4. Runs `bun run packages/opencode/script/build.ts -- --target <target>`.
5. Copies the resulting binary into `artifacts/`. On Windows targets it also produces a `.zip`.

The full list of valid targets is enumerated in `packages/opencode/script/build.ts` and printed by `bash build.sh --help`.

### `build-and-install.ps1` (Windows one-shot)

The PowerShell entry point for Windows developers. It wraps `build.sh` in WSL, then calls `install-windows.ps1` to drop the binary in `%LOCALAPPDATA%\Programs\OpencodeX` and add it to your user `PATH`.

```powershell
# Build with defaults (win32-x64-baseline) and install
pwsh -File .\build-and-install.ps1

# Specific target
pwsh -File .\build-and-install.ps1 -Target win32-x64

# Minified build
pwsh -File .\build-and-install.ps1 -Minify

# Clean /tmp/OpencodeX first
pwsh -File .\build-and-install.ps1 -Clean

# Build but don't install (useful for CI or sharing the artifact)
pwsh -File .\build-and-install.ps1 -SkipInstall

# Pick a specific WSL distro
pwsh -File .\build-and-install.ps1 -Distro Ubuntu-22.04

# Override the install directory
pwsh -File .\build-and-install.ps1 -InstallDir C:\Tools\OpencodeX
```

The script auto-detects the WSL mount path for the repo (e.g. `C:\Work\OpencodeX` → `/mnt/c/Work/OpencodeX`). It then invokes `wsl.exe bash -c "cd <wslpath> && bash build.sh ..."` and pipes through the result.

### `install-windows.ps1` (Windows, prebuilt artifact)

Use this when you already have a `.zip` or `.exe` artifact in `artifacts/` and just want to drop it on the system.

```powershell
# Auto-detect an artifact in artifacts/ and install
.\install-windows.ps1

# Specific artifact
.\install-windows.ps1 -ArtifactPath .\artifacts\opencodex-windows-x64-baseline.zip

# Install somewhere other than %LOCALAPPDATA%\Programs\OpencodeX
.\install-windows.ps1 -InstallDir C:\Tools\OpencodeX

# Don't touch PATH
.\install-windows.ps1 -NoPathUpdate

# Uninstall
.\install-windows.ps1 -Uninstall
```

`install-windows.ps1` extracts the artifact, copies the `.exe` into the install directory, prepends that directory to your user `PATH`, and runs `<binary> --version` to confirm the install. Restart your terminal afterward.

## CLI name resolution (`opencode` vs `opencodex`)

The same `packages/opencode/bin/opencode` shim is registered as both `opencode` and `opencodex` in the workspace `package.json`. At runtime, the shim sets `OPENCODE_CLI_NAME` based on the name of the binary that was invoked:

```sh
# From bin/opencode
env: {
  ...process.env,
  OPENCODE_CLI_NAME: process.argv0.toLowerCase().includes("opencodex") ? "opencodex" : "opencode",
},
```

The TUI uses this to drive the `opencode` vs `opencodex` branding (the dashboard title, the dashboard CLI command printed on first run, etc.). When you run `bun dev`, the resolved binary path is `packages/opencode/bin/opencode`, so by default you are running as the `opencode` brand. The built `opencodex` Windows binary switches to the `opencodex` brand.

## Adding code to the right place

A few rules of thumb that have been burned into the project:

- **TUI features**: reuse the existing components under `packages/opencode/src/cli/cmd/tui/component/` and drive colors from the theme context rather than hardcoding them. `packages/ui` is the GUI's Solid component library, not the TUI's — the only thing the TUI pulls from it is the notification audio.
- **New keybindings**: register them in `packages/opencode/src/cli/cmd/tui/config/keybind-definitions.ts` (the `keybind(...)` table) and the corresponding action id in the map at the bottom of the same file. This is what makes them show up in the command palette.
- **OpencodeX-only TUI features**: the sidebar lives in `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar*.{ts,tsx}` (view, controller, model, projection, rows are separate files). New overlay state and HTTP routes go in `packages/opencode/src/server/routes/instance/httpapi/groups/opencodex.ts` and `handlers/opencodex.ts`. The project folder and project services live under `packages/opencode/src/opencodex/`.
- **Schema changes**: new SQLite sidecar tables for OpencodeX go in `packages/core/src/opencodex/sql.ts` and a migration in `packages/core/src/database/migration/*opencodex*`. Do not change upstream schemas in place — the fork is designed to merge cleanly.
- **Provider logic**: avoid editing providers in this repo. Add or update them upstream in `models.dev`.

## Debugging

Bun's debugger is, by the upstream team's own admission, "rough around the edges". The most reliable approach is to attach via WebSocket:

```bash
# Run the TUI with the inspector attached
BUN_OPTIONS=--inspect=ws://localhost:6499/ bun dev

# Or run the headless server separately
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096
# then in another terminal
opencode attach http://localhost:4096
```

Some other tips that come up repeatedly:

- If breakpoints in the server don't trigger, split the processes: run `serve` under the inspector and attach the TUI to it (the two-command recipe above). `bun dev` with any of `--port`, `--hostname`, or `--mdns` moves the server into a `Worker` (see `packages/opencode/src/cli/cmd/tui/thread.ts`), where breakpoints frequently do not bind. There is no `bun dev spawn` subcommand.
- `--inspect-wait` and `--inspect-brk` are also available, and `BUN_OPTIONS=--inspect=...` in your shell saves you from retyping the URL.
- The TUI's `tree-sitter` parser worker is its own process; to step into it, set `OTUI_TREE_SITTER_WORKER_PATH` (the build sets this to a `B:/~BUN/root/` path on Windows).
- VS Code launch configurations are checked in as `.vscode/launch.example.json` and `.vscode/settings.example.json` — copy them to `launch.json` / `settings.json` if you use VS Code, and adapt the inspect URL.

For the TUI specifically:

- The most useful thing to log from is `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` and the sidebar component. The `createFrames({ color, style, ... })` helper in `packages/opencode/src/cli/cmd/tui/ui/spinner.ts` is what drives the whip animation, and accepts an `inactiveFactor` and `minAlpha` to tune the visual weight.
- Status color logic lives in the same area. The status enum is `dormant | in_progress | input_needed` and is rendered by the sidebar.

## Releasing

The release pipeline is `.github/workflows/release-cli.yml`. It builds the CLI from an Ubuntu runner, packages the generated binaries as `opencodex-*` assets, and uploads them with `install` and `install-windows.ps1` to a GitHub Release.

The workflow is **`workflow_dispatch` only** — there is no tag trigger, and pushing a `vX.Y.Z` tag
does not release anything. The version comes from `packages/opencode/package.json`; the optional
`version` input must match it exactly or the run fails its own check. The quality gate
(`typecheck`, `test:ci`, `lint:ci`, `git diff --check`) runs before anything is built.

To publish a release:

1. Bump `packages/opencode/package.json` and merge that to `main`.
2. Open the `release-cli` workflow in GitHub Actions and run it from `main` (leave `version` blank to use the manifest value). Releases are marked prerelease by default; uncheck `prerelease` for a stable one.
3. Confirm the release contains:

   ```text
   install
   install-windows.ps1
   opencodex-linux-*.tar.gz
   opencodex-darwin-*.zip
   opencodex-windows-*.zip
   SHA256SUMS
   ```

Once the release is published, users can install with:

```bash
curl -fsSL https://github.com/ecgreen/OpencodeX/releases/latest/download/install | bash
```

or on Windows:

```powershell
irm https://github.com/ecgreen/OpencodeX/releases/latest/download/install-windows.ps1 -OutFile install-windows.ps1
pwsh -File .\install-windows.ps1
```

The desktop GUI preview ships from a separate `release-gui` workflow — see [`RELEASE_GUIDE.md`](RELEASE_GUIDE.md).

The local fallback flow is:

1. Bump the version in `packages/opencode/package.json` (the value that ends up in `--version`, and the value `packages/script` reports as `Script.version`).
2. Build the targets you want to ship:

   ```bash
   bash build.sh --target win32-x64-baseline
   bash build.sh --target darwin-arm64
   bash build.sh --target linux-x64
   ```
3. The artifacts land in `artifacts/` as both a single `.exe`/binary and a `.zip` (Windows) or `.tar.gz` (Linux). The zip is built by `packages/opencode/script/build.ts` via the `gh release upload` step, which only runs when `Script.release` is true.
4. SHA-256s and any signing happens out of band today. `script/sign-windows.ps1` is in the repo for future use.

If you are tagging a release for the first time, also regenerate the SDK first so any breaking schema changes are reflected in `packages/sdk/js`:

```bash
./packages/sdk/js/script/build.ts
```

## Upstream merge workflow

OpencodeX is an additive overlay on top of upstream `opencode`. The process, the release-sync
runbook, and the **divergence ledger** (upstream files this fork deliberately deleted, moved, or
split — do not restore them during conflict resolution) all live in
[`docs/UPSTREAM.md`](docs/UPSTREAM.md). The short version:

- The upstream pin is `upstream/lock.json`; the machine-enforced surface policy is `upstream/policy.json`, checked by `bun run surface:audit`.
- New TUI files live under `packages/opencode/src/opencodex/` and `packages/opencode/src/cli/cmd/tui/component/opencodex-sidebar*.{ts,tsx}`.
- New HTTP surface lives under `packages/opencode/src/server/routes/instance/httpapi/groups/opencodex.ts` and `handlers/opencodex.ts`.
- The HTTP server registers the OpencodeX handlers via `server.ts`. The API group is registered in `api.ts`.
- Schema additions for OpencodeX (projects, folders, sessions) live in `packages/core/src/opencodex/sql.ts` and a migration in `packages/core/src/database/migration/*opencodex*`.
- The few upstream files OpencodeX does touch (project service, instance store, system prompt, session listing, project ID derivation) are all small, well-marked seams.

The sync itself is driven by two scripts, both run from the repo root:

```bash
bun run upstream:status vX.Y.Z --markdown   # what changed upstream, grouped by area
bun run upstream:rehearse vX.Y.Z            # measure the merge/conflict surface without touching the worktree
```

After a sync merge lands on your branch:

```bash
git diff origin/main...HEAD -- packages/opencode/src
bun run typecheck
bun run surface:audit
cd packages/opencode && bun test test/opencodex
./packages/sdk/js/script/build.ts            # generated SDK output must have no unexplained diff
```

If the diff against upstream is non-trivial, regenerate the changelog as well:

```bash
bun run script/changelog.ts
```

## Troubleshooting

**`bun install` fails with a 403 on an optional package.**
`build.sh` already handles this — it warns and continues. Optional packages that 403 on the build host will still resolve when the consumer installs the binary.

**`bun dev` says `bun: command not found` inside WSL.**
You installed Bun but the new shell session does not have `~/.bun/bin` on the PATH yet. Either `source ~/.bashrc` (or your shell equivalent) or add `export PATH="$HOME/.bun/bin:$PATH"` to your shell rc.

**`build.sh` complains about a missing PE header on the Windows binary.**
The WSL build succeeded but the artifact is not a valid Windows executable. This usually means the cross-compile step was killed mid-flight. Try `bash build.sh --clean` and rerun.

**`build-and-install.ps1` says it cannot find WSL.**
Install WSL 2 with `wsl --install` from an elevated PowerShell, reboot, and try again. If you have multiple distros installed, the script auto-detects the default — pass `-Distro <name>` to override.

**`opencodex` works but my data folder is the wrong one.**
`opencodex` (and `opencode`) honor `XDG_DATA_HOME` on Linux, `~/Library/Application Support` on macOS, and `%LOCALAPPDATA%` on Windows. The on-disk schema is identical to upstream `opencode`, so pointing both CLIs at the same data dir is safe.

**Tests refuse to run from the repo root.**
That is intentional — the root `package.json` has a guard script. `cd packages/opencode` (or whichever package the test is in) and re-run.

**The TUI looks broken in Windows Terminal.**
Set Windows Terminal's color scheme to "Campbell" or "One Half Dark". The OpenTUI components assume a 24-bit color terminal; legacy 16-color schemes are unsupported on Windows.

**`bun run lint` prints thousands of warnings.**
Expected. The repo lints against a recorded baseline: `bun run lint:ci` (`script/check-lint-baseline.ts`) compares the current count against `.oxlint-baseline.json` and only fails on regressions. Use `lint:ci` to decide whether your change is clean.

**`bun run surface:audit` fails after I moved or deleted a package.**
`upstream/policy.json` is the source of truth for which workspaces exist and which upstream paths are permanently pruned. Update it in the same change that moves the files.

## Claude bridge changes require a coordinator restart

The GUI reuses an already-running coordinator (`gui-coordinator.ts`) across app
restarts. Changes to `packages/opencode` (mapper, driver, session loop) only
take effect when that process restarts — quitting the GUI is not enough. Kill
the `bun run … gui-coordinator.ts` process (or run the packaged updater); the
next GUI connection respawns it from current source.
