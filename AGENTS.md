- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `main`.
- Use `main` or `origin/main` as the integration base for diffs and pull requests.

## Graphify Knowledge Graph

Use Graphify before broad repo exploration whenever `graphify-out/graph.json` exists. Prefer a focused graph query over grepping or reading many files, then open the specific source files returned by the graph to verify details before editing. The current `.graphifyignore` scopes the graph to the GUI package, the opencode TUI implementation, related TUI tests, and `tui-*.ts` fixtures.

Best workflow:

- Start with `graphify query "<specific task question>"` for orientation, especially when the task asks "where is this implemented?", spans GUI/TUI boundaries, or involves session/message synchronization.
- Use focused domain terms in queries, such as `session synchronization`, `message.part.delta`, `permission.asked`, `store parity`, `opencodex sidebar`, or a known function/type name. Avoid generic-only queries like `gui` or `tui`; they can surface package scripts and other nearby noise.
- Follow promising hits with `graphify explain "<symbol>"` to inspect that symbol's callers, callees, source file, line number, and graph neighborhood.
- Use `graphify path "<symbol A>" "<symbol B>"` when trying to understand how two concepts are connected before opening a chain of files.
- After graph orientation, read the actual source files and tests it points to. The graph is a navigation aid, not a substitute for verifying behavior in code.
- For GUI/TUI session work, useful starting points discovered by the graph include `loadSessionCards`, `loadSnapshot`, and `loadSession` in `packages/gui/src/renderer/src/lib/session-api.ts`, live patching around `patchSessionData` in `packages/gui/src/renderer/src/app.tsx`, parity tests in `packages/gui/test/store.parity.test.ts`, and TUI session rendering in `packages/opencode/src/cli/cmd/tui/routes/session/session-messages.tsx`.

Common commands:

- `uv tool install graphifyy` - install the official PyPI package; the CLI command is still `graphify`.
- `graphify install --project --platform codex` - install the project-scoped Codex skill files.
- `graphify query "where is session state synchronized?"` - ask a focused codebase question.
- `graphify explain "Session"` - summarize a symbol, module, or concept.
- `graphify path "Session" "Database"` - find relationships between two concepts.
- `graphify .` - build or rebuild the graph from the repo root.
- `graphify . --update` - incrementally re-extract changed files.
- `graphify . --cluster-only` - rerun community detection without extraction.
- `graphify . --no-viz` - skip `graph.html` and produce report/JSON only.
- `graphify export callflow-html` - generate an architecture/call-flow view.
- `graphify hook install` - install git hooks for post-commit/post-checkout graph maintenance and merge handling.
- `graphify codex install` or `graphify opencode install` - refresh always-on assistant instructions/hooks for this repo.

Codex uses `$graphify` as the assistant command, while PowerShell should use terminal commands like `graphify .` without a leading slash. If the `graphify` shim is unavailable, inspect `graphify-out/.graphify_python` and run that interpreter with `-m graphify`.

Graphify output should normally include:

- `graphify-out/graph.json` - the queryable graph.
- `graphify-out/GRAPH_REPORT.md` - broad architecture highlights and suggested questions.
- `graphify-out/graph.html` - browser visualization when built without `--no-viz`.

If `graphify-out/graph.json` is missing, do not assume the graph is ready. Check `graphify-out/.graphify_detect.json` and `.graphifyignore`. To expand the indexed surface, update the `.graphifyignore` allowlist first, then rebuild.

Privacy and scope notes:

- Code extraction is local AST processing; docs, PDFs, images, and other unstructured files may use the configured LLM backend.
- Query commands may log metadata to the default Graphify query log. Set `GRAPHIFY_QUERY_LOG_DISABLE=1` if needed.
- Treat graph results as navigation hints. Always confirm behavior against the actual files before making changes.

## GUI Session Scroll Behavior

Session transcript scroll behavior is intentionally centralized and should stay simple.

- The scroll controller lives in `packages/gui/src/renderer/src/components/session-transcript-scroll-controller.ts`; `session-transcript-panel.tsx` only wires it into the view.
- Pure scroll decision helpers live in `packages/gui/src/renderer/src/lib/transcript-scroll.ts`, with coverage in `packages/gui/test/transcript-scroll.test.ts`.
- Session transcript layout CSS is split across the GUI stylesheets, with base `.transcript` scrolling in `packages/gui/src/renderer/src/styles/pages/sessions/transcript-shell.css`, Load More affordance styling in `packages/gui/src/renderer/src/styles/pages/sessions/transcript-paging.css`, and stage/session overflow constraints in `packages/gui/src/renderer/src/styles/global/shell/stage.css`.

Keep exactly these automatic transcript scroll rules:

- If the active session is at or near the bottom, within `200px`, keep the transcript pinned to the bottom when transcript content or viewport size changes.
- If the user provides scroll input, including wheel-up, touch, or scrollbar interaction, stop automatic bottom-follow for the short release window defined in `packages/gui/src/renderer/src/lib/transcript-scroll.ts`; after that, re-enable only when the user is near-bottom again.
- When using Load More, preserve the clicked Load More button's viewport anchor while older content is inserted above it.

Do not reintroduce layered automatic scroll behavior such as open-session settle loops, submit-time prompt-follow scrolling, first-visible-message prepend anchors, multi-frame restore loops, or smooth automatic transcript scrolling. Composer height changes must not move session content unless bottom-follow is already active. Explicit transcript navigation commands, such as keyboard or palette jumps in `packages/gui/src/renderer/src/app.tsx`, are user-directed and may remain separate from this automatic scroll policy.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking, Build, and Bun

- Bun is available in supported development environments, including sandboxes.
- Run relevant scoped typecheck, lint, test, or build commands when they are useful to validate changes.
- Prefer package-level commands from the affected package directory over broad repo-wide commands unless the change requires full-repo validation.
- If a command is expected to be long-running, destructive, or environment-specific, call it out first and ask which command the user wants run.

## Questions Need Their Context Attached

Assistant prose emitted mid-turn can be lost upstream of the GUI (see
docs/superpowers/specs/2026-08-09-question-card-and-transcript-visibility-design.md,
Part B finding 3). When asking the user to approve or choose anything, put the
material they need INSIDE the question payload (the `question` field renders
long text) or in a committed file the question references - never rely on
turn-middle message text being visible.

## Specs and Plans Are Never Committed

Everything under `docs/superpowers/` — design specs in `specs/`, implementation
plans in `plans/` — is a working artifact for the session that produced it.
Write them to disk so they can be read and revised, but **never `git add` or
commit them**, and never include them in a PR. If a commit is being prepared and
one of these files is staged, unstage it.

This is also why commit steps inside a plan list explicit paths: `git add -A` or
`git add .` would sweep the plan itself into the commit.

Anything from a spec or plan that the codebase needs to keep belongs in the
code, in a comment next to what it explains, or in this file — not in a
committed document.
