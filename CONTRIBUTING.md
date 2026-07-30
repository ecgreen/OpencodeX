# Contributing to OpencodeX

We want to make it easy for you to contribute to OpencodeX. Here are the most common type of changes that get merged:

- Bug fixes
- Additional LSPs / Formatters
- Improvements to LLM performance
- Support for new providers
- Fixes for environment-specific quirks
- Missing standard behavior
- Documentation improvements

However, any UI or core product feature must be discussed with the maintainer before implementation.

If you are unsure if a PR would be accepted, open an issue and ask, or look for existing issues with any of the following labels:

- [`help wanted`](https://github.com/ecgreen/OpencodeX/issues?q=is%3Aissue+state%3Aopen+label%3A%22help+wanted%22)
- [`good first issue`](https://github.com/ecgreen/OpencodeX/issues?q=is%3Aissue+state%3Aopen+label%3A%22good+first+issue%22)
- [`bug`](https://github.com/ecgreen/OpencodeX/issues?q=is%3Aissue+state%3Aopen+label%3Abug)
- [`perf`](https://github.com/ecgreen/OpencodeX/issues?q=is%3Aissue+state%3Aopen+label%3Aperf)

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

Want to take on an issue? Leave a comment and the maintainer may assign it to you unless it is already being worked on.

Note that OpencodeX is a fork of [opencode](https://github.com/anomalyco/opencode). If your change is
to shared upstream behavior rather than to something this fork added, it will usually land faster
upstream — this fork picks up upstream releases through the sync process in
[`docs/UPSTREAM.md`](docs/UPSTREAM.md). Report bugs and feature requests for OpencodeX itself here,
not upstream.

## Adding New Providers

New providers shouldn't require many if ANY code changes. Provider and model metadata is loaded from
[models.dev](https://models.dev), not from this repo, so to add support for a new provider make a PR to
<https://github.com/anomalyco/models.dev> — it will then appear in OpencodeX on the next fetch.

## Developing OpencodeX

- Requirements: Bun 1.3+
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

### Running against a different directory

By default, `bun dev` runs OpencodeX in the directory you invoked it from. To run it against a different directory or repository:

```bash
bun dev <directory>
```

To run OpencodeX in the root of this repo itself:

```bash
bun dev .
```

### Building a "localcode"

To compile a standalone executable for your current platform:

```bash
./packages/opencode/script/build.ts --single
```

Then run it with:

```bash
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`, `windows-x64`).

Add `--skip-install` to skip the `bun install` the build runs inside `dist/`, and `--no-minify` if
you hit a Bun compile quirk. For cross-compiling and the Windows pipeline, see
[`DEV_README.md`](DEV_README.md).

- Core pieces:
  - `packages/opencode`: OpencodeX CLI, TUI, and server.
  - `packages/opencode/src/cli/cmd/tui/`: The TUI code, written in SolidJS with [opentui](https://github.com/sst/opentui)
  - `packages/core`: agent runtime, SQLite schema, and migrations.
  - `packages/gui`: Electron desktop GUI public preview.
  - `packages/plugin`: Source for `@opencode-ai/plugin`
  - `github/`: the published GitHub Action.

### Developing the GUI preview

From the repo root:

```bash
bun dev:electron
```

Run GUI validation from the package directory:

```bash
cd packages/gui
bun run typecheck
bun test
bun run qa
```

Package a local desktop build:

```bash
cd packages/gui
bun run package
bun run smoke:packaged
```

Packaged GUI builds launch a local OpencodeX sidecar coordinator and talk to it through the generated SDK. The GUI should not read or write backend SQLite files directly.

### Understanding bun dev vs opencode

During development, `bun dev` is the local equivalent of the built `opencode` command. Both run the same CLI interface:

```bash
# Development (from project root)
bun dev --help           # Show all available commands
bun dev serve            # Start headless API server
bun dev <directory>      # Start TUI in specific directory

# Production
opencode --help          # Show all available commands
opencode serve           # Start headless API server
opencode <directory>     # Start TUI in specific directory
```

### Running the API Server

To start the OpencodeX headless API server:

```bash
bun dev serve
```

This starts the headless server on port 4096 by default. You can specify a different port:

```bash
bun dev serve --port 8080
```

> [!NOTE]
> If you make changes to the API or SDK (e.g. `packages/opencode/src/server/server.ts`), run `./packages/sdk/js/script/build.ts` to regenerate the SDK and related files.

Please try to follow the [style guide](./AGENTS.md)

### Before you push

```bash
bun run typecheck
bun run lint:ci
bun run surface:audit
```

`bun run lint` reports the full oxlint warning set, most of which is baselined; `bun run lint:ci` is
the gate that actually fails on regressions. `surface:audit` enforces `upstream/policy.json` — run it
whenever you add, move, or delete a workspace or an upstream-owned path.

### Setting up a Debugger

Bun debugging is currently rough around the edges. We hope this guide helps you get set up and avoid some pain points.

The most reliable way to debug OpencodeX is to run it manually in a terminal via `bun run --inspect=<url> dev ...` and attach
your debugger via that URL. Other methods can result in breakpoints being mapped incorrectly, at least in VSCode (YMMV).

Caveats:

- If you want breakpoints to trigger in the **server** code, debug the two processes separately. `bun dev` with any of `--port`, `--hostname`, or `--mdns` moves the server into a `Worker` (see `packages/opencode/src/cli/cmd/tui/thread.ts`), where breakpoints frequently do not bind.
  - Debug server: `bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096`,
    then attach the TUI with `opencode attach http://localhost:4096`
  - Debug TUI: `bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts`

Other tips and tricks:

- You might want to use `--inspect-wait` or `--inspect-brk` instead of `--inspect`, depending on your workflow
- Specifying `--inspect=ws://localhost:6499/` on every invocation can be tiresome, you may want to `export BUN_OPTIONS=--inspect=ws://localhost:6499/` instead

#### VSCode Setup

If you use VSCode, you can use our example configurations [.vscode/settings.example.json](.vscode/settings.example.json) and [.vscode/launch.example.json](.vscode/launch.example.json).

Some debug methods that can be problematic:

- Debug configurations with `"request": "launch"` can have breakpoints incorrectly mapped and thus unusable
- The same problem arises when running OpencodeX in the VSCode `JavaScript Debug Terminal`

With that said, you may want to try these methods, as they might work for you.

## Pull Request Expectations

### Issue First Policy

**All PRs must reference an existing issue.** Before opening a PR, open an issue describing the bug or feature. This helps maintainers triage and prevents duplicate work. PRs without a linked issue may be closed without review.

- Use `Fixes #123` or `Closes #123` in your PR description to link the issue
- For small fixes, a brief issue is fine - just enough context for maintainers to understand the problem

### General Requirements

- Keep pull requests small and focused
- Explain the issue and why your change fixes it
- Before adding new functionality, ensure it doesn't already exist elsewhere in the codebase

### UI Changes

If your PR includes UI changes, please include screenshots or videos showing the before and after. This helps maintainers review faster and gives you quicker feedback.

### Logic Changes

For non-UI changes (bug fixes, new features, refactors), explain **how you verified it works**:

- What did you test?
- How can a reviewer reproduce/confirm the fix?

### No AI-Generated Walls of Text

Long, AI-generated PR descriptions and issues are not acceptable and may be ignored. Respect the maintainers' time:

- Write short, focused descriptions
- Explain what changed and why in your own words
- If you can't explain it briefly, your PR might be too large

### PR Titles

PR titles should follow conventional commit standards:

- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation or README changes
- `chore:` maintenance tasks, dependency updates, etc.
- `refactor:` code refactoring without changing behavior
- `test:` adding or updating tests

You can optionally include a scope to indicate which package is affected:

- `feat(tui):` feature in the TUI
- `fix(opencode):` bug fix in the opencode package
- `chore(sdk):` maintenance in the SDK

Examples:
- `docs: update contributing guidelines`
- `fix: resolve crash on startup`
- `feat: add dark mode support`
- `feat(tui): add conversation status indicator`
- `fix(opencode): resolve crash on startup`
- `chore: bump dependency versions`

### Style Preferences

These are not strictly enforced, they are just general guidelines:

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse or composition benefits.
- **Destructuring:** Do not do unnecessary destructuring of variables.
- **Control flow:** Avoid `else` statements.
- **Error handling:** Prefer `.catch(...)` instead of `try`/`catch` when possible.
- **Types:** Reach for precise types and avoid `any`.
- **Variables:** Stick to immutable patterns and avoid `let`.
- **Naming:** Choose concise single-word identifiers when they remain descriptive.
- **Runtime APIs:** Use Bun helpers such as `Bun.file()` when they fit the use case.

## Feature Requests

For net-new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach (optional), and why it belongs in OpencodeX. The maintainer will help decide whether it should move forward; please wait for that decision instead of opening a feature PR directly.

## Issue Requirements

Blank issues are disabled. Every issue must use one of the templates in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE):

- **Bug report** — general bugs (requires a description)
- **Feature request** — suggesting enhancements
- **Question** — asking questions
- **Install failure** — installer or upgrade problems
- **Provider / model issue** — a specific provider or model misbehaving
- **TUI rendering issue** — terminal rendering, layout, or theme problems
- **GUI sidecar failure** — the desktop preview failing to reach its local coordinator

Issues may be closed for:

- Not using a template
- Required fields left empty or filled with placeholder text
- AI-generated walls of text
- Missing meaningful content

If you believe your issue was closed in error, say so in a comment and it will be reopened.

## Security Issues

Do not open a public issue for a security vulnerability. Follow [`SECURITY.md`](SECURITY.md) — report
privately through the repository's Security tab.
