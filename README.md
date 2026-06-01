# OpencodeX

OpencodeX is a terminal-native fork of [`opencode`](https://github.com/anomalyco/opencode).

The old VS Code extension approach has been abandoned. This codebase starts from upstream `opencode` and will evolve into a terminal workspace for managing many AI coding conversations at once: a high-level dashboard, conversation sidebar, resumable history, concurrent agent instances, and clear input-needed status.

## First Command

```bash
opencodex
```

`opencodex` opens the persistent conversation dashboard by default. Use arrow keys or `j`/`k` to choose a conversation, `Enter` to resume it, `n` to start a new conversation, and `q` to quit.

For scripting, use `opencodex dashboard --format table` or `opencodex dashboard --format json`.

## Development

This repo follows upstream's Bun workspace setup.

```bash
bun install
bun run --cwd packages/opencode typecheck
```

See `docs/opencodex.md` for the product direction and implementation path.
