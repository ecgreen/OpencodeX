# OpencodeX architecture and ownership

OpencodeX is a compatibility fork of opencode with two fork-owned clients: the custom terminal UI and the Electron GUI. The backend remains intentionally close to upstream so sessions, providers, authentication, MCP, plugins, the JavaScript SDK, and the standard server API/event stream remain interoperable.

## Retained runtime

- `packages/opencode`: CLI, headless server, backend, session runtime, providers, MCP, plugins, and the custom TUI.
- `packages/core`: shared schemas, durable storage, database migrations, events, and cross-client contracts.
- `packages/gui`: the fork-owned Electron main/preload processes and Solid renderer.
- `packages/sdk/js`: generated JavaScript client for the retained server contract.
- `packages/ui`: the Solid components the GUI imports, a small shared stylesheet set, and the five production notification sounds the TUI imports. The upstream icon sprites, fonts, themes, i18n catalogue, and web-frontend components were pruned — see the divergence ledger in [`UPSTREAM.md`](UPSTREAM.md).
- `packages/plugin`, `packages/llm`, `packages/script`, the Effect SQLite adapters, and HTTP recorder support.
- `github`: the versioned OpencodeX GitHub Action.

The machine-readable source of truth is [`upstream/policy.json`](../upstream/policy.json). `bun run surface:audit` fails if a removed surface returns, a retained workspace references a removed workspace, a catalog/patch entry is orphaned, or fork-owned configuration restores an upstream product URL.

## Ownership boundary

The full `packages/gui` package, the TUI directory, `packages/opencode/src/opencodex`, OpencodeX overlay routes, repository CI/releases, and the GitHub Action are fork-owned. Upstream GUI/Desktop/TUI changes are feature-port candidates, not merge authorities.

Backend, provider, MCP, plugin, session, SDK, and event-stream paths are upstream-owned unless listed as a shared seam. Shared seams always receive manual review during a sync. OpencodeX database migrations remain additive and execute after compatible upstream migrations.

## Compatibility invariants

- Existing session storage and history continue to open in both clients.
- Provider, authentication, MCP, plugin, JavaScript SDK, and standard server contracts do not intentionally break.
- OpencodeX additions use namespaced overlay routes and additive tables/migrations.
- GUI and TUI reduce the same session/message/part/status/permission/question events and recover through the same replay/resync contract.
