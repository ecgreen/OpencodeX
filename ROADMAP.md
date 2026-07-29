# OpencodeX roadmap

## Current

- Land the green TUI/GUI foundation and tag its merge commit as the recoverable pre-prune baseline.
- Merge repository reduction, GitHub rebranding, and upstream metadata as reviewable conventional-commit PRs.
- Complete one rehearsal sync from the pinned `v1.15.13` snapshot to a selected release and establish Git ancestry.

## Acceptance before declaring upstream sync complete

- Linux and Windows frozen installs, retained-surface audit, typecheck, lint, and retained-workspace units.
- Empty, upstream-existing, and OpencodeX-existing database upgrades with no generated migration drift.
- TUI smoke for launch/attach, navigation, sessions, providers, permissions/questions, MCP/plugins, reconnect, and multi-session state.
- GUI functional/browser E2E, sidecar startup, and manual packaged Electron smoke.
- TUI/GUI event and storage parity, deterministic JavaScript SDK generation, GitHub Action fixtures, and cross-platform release dry-runs.

Nix, hosted enterprise infrastructure, Slack, websites, editor extensions, preview CLI, and upstream front ends are not supported products unless a future architecture decision explicitly restores them.

## Support policy: no upstream-hosted egress

OpencodeX does not send session data to infrastructure it does not operate. As of 2026-07-29 the
paths that used to do so are removed from the tree, not merely disabled: session sharing (`opncd.ai`),
the `app.opencode.ai` web-UI reverse proxy and the `web` command, and console/account login. Restoring
any of them is an architecture decision, not a bug fix. The complete list, with the paths deleted, is
the divergence ledger in [`docs/UPSTREAM.md`](docs/UPSTREAM.md); a sync must not reintroduce them
silently.
