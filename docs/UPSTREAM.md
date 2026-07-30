# Upstream synchronization

The official remote is `https://github.com/anomalyco/opencode.git`, configured locally as `upstream`. [`upstream/lock.json`](../upstream/lock.json) records the exact imported release/SHA, observation date, and separately applied backports.

The initial OpencodeX repository is a snapshot import without a Git merge-base. Its identified source snapshot is opencode `v1.15.13` (`385cb694419f98103af0e8fc6187ddcbcbb6eecb`). The first sync PR must establish ancestry with `--allow-unrelated-histories` and resolve the import deliberately; it must not use a blanket `ours` strategy. Once that PR merges, set `historyMode` to `merged`; subsequent release syncs use ordinary `--no-ff` merges.

## Release sync runbook

1. `git fetch upstream --tags`, run `bun run upstream:status vX.Y.Z --markdown`, then run `bun run upstream:rehearse vX.Y.Z`. The report groups backend, storage, SDK/API, providers, dependencies, upstream front ends, pruned paths, and shared seams; the rehearsal measures the real merge/conflict surface without changing the worktree.
2. Create `chore/upstream-vX.Y.Z` from `main`.
3. Merge the exact tag commit with `git merge --no-ff vX.Y.Z` (add `--allow-unrelated-histories` only for the first lineage PR).
4. Accept upstream-owned backend changes, preserve fork-owned paths, remove anything in `permanentlyPrunedPaths`, and manually review every shared seam. Run `bun run surface:audit` until clean.
5. Treat upstream TUI/Desktop changes as a behavior-port checklist. Port useful behavior into OpencodeX clients without restoring upstream front ends.
6. Reconcile `package.json`, `bun.lock`, catalog entries, and patches. Run `bun install`, then verify `bun install --frozen-lockfile`.
7. From `packages/sdk/js`, run `bun script/build.ts`; generated output must have no unexplained diff.
8. From `packages/core`, run `bun script/migration.ts --check`, empty-database migration tests, and upgrade fixtures for upstream-existing and OpencodeX-existing databases.
9. Open a draft PR titled `chore(upstream): sync opencode vX.Y.Z`. Attach the generated report, migration/API/provider diffs, front-end port list, pruned paths removed, and backports satisfied.
10. Update `upstream/lock.json` only after all gates pass and the sync PR merges.

The monthly `Upstream status` workflow edits one tracking issue only when the upstream release marker changes. `Upstream sync report` is manual and produces a report artifact; it never commits conflict resolutions unattended.

## Divergence ledger

Because the first sync has not run yet, upstream-owned files that this fork **deliberately** deleted
or moved would otherwise look like accidental drops during merge conflict resolution. Record them
here as they happen. During a sync, a conflict against any path below is resolved by **keeping the
fork's removal**, not by restoring upstream's file — unless the entry says otherwise.

`upstream/policy.json` (`permanentlyPrunedPaths`) is the machine-enforced half of this and is
checked by `bun run surface:audit`. This section is the human-readable half: it also covers files
that were *moved or split* rather than pruned, which policy.json cannot express.

### 2026-07 — cleanup branch (pre-first-sync)

Deleted, upstream-owned (do not restore on merge):

| Path | Note |
| --- | --- |
| `packages/opencode/src/cli/cmd/run/` (33 files) + `packages/opencode/test/cli/run/` (18 files) | The `run --interactive` second TUI. `cmd/run.ts` (non-interactive `opencode run`) is **kept**; only the interactive front end is gone, along with the `--interactive` flag. |
| `packages/opencode/src/share/`, `packages/core/src/share/sql.ts`, `test/share/` | Share pipeline (`opncd.ai` egress) and its `/share` surface. |
| `packages/opencode/src/account/`, `packages/core/src/account*`, `cli/cmd/account.ts`, `component/dialog-console-org.tsx` | Console/account login. |
| `packages/opencode/src/server/shared/ui.ts`, `public-ui.ts`, `test/server/httpapi-ui.test.ts` | The `app.opencode.ai` web-UI reverse proxy and the `web` command. |
| `packages/opencode/src/pty/`, `httpapi/handlers/pty.ts`, `server/shared/pty-ticket.ts`, `test/pty/` | The PTY HTTP surface. |
| `httpapi/groups/v2/`, `httpapi/handlers/v2/`, `cli/cmd/tui/context/sync-v2.tsx`, `feature-plugins/system/session-v2*` , `packages/sdk/js/src/v2/data.ts` | The experimental v2 event/session system. |
| `packages/sdk/js/src/v2/legacy-session-sync.ts`, `script/check-legacy-session-sync.ts`, `docs/session-sync-compatibility.md` | The legacy session-sync endpoint and its compatibility gate. |
| ~76% of `packages/ui/src` — all of `theme/`, `hooks/`, `storybook/`, `styles/tailwind/`, the icon/favicon/image asset sets, most of `components/`, `v2/`, `i18n/`, `context/` | Upstream web-frontend residue. `packages/ui` survives only as the Solid components the GUI still imports (`file`, `markdown`, `code-block`, `popover`, `logo`, `session-diff`, `tool-output-preview`, `context/marked`, four `v2/components/*-v2`) plus the five notification `.mp3`s the TUI imports. Anything outside that set is intentionally gone; re-adding a file here needs a live importer. |
| `packages/{containers,identity,extensions,effect-sqlite-node}`, `script/{publish.ts,release,generate.ts}`, `packages/plugin/src/example*.ts` | Vestigial upstream packages and scripts. Also in `permanentlyPrunedPaths`. |
| `packages/opencode/script/publish.ts`, `packages/plugin/script/publish.ts`, `packages/sdk/js/script/publish.ts` | Upstream's release pipeline: Docker push to `ghcr.io/anomalyco/opencode`, AUR PKGBUILDs, a Homebrew tap, and `npm publish` to the `@opencode-ai` scope this fork does not own. The fork releases via `.github/workflows/release-cli.yml` + `script/build.ts` only. Also in `permanentlyPrunedPaths`. |

Moved or split (a merge conflict here means upstream edited the *old* path — port the change into the new one):

| Upstream path | Now |
| --- | --- |
| `packages/opencode/src/session/prompt.ts` (monolith) | Split into `prompt.ts` + `prompt-{claim,schema,shell,structured-output,subtask,swarm,user-message}.ts` in the same directory. |
| `packages/opencode/src/util/filesystem.ts` (pure path helpers) | Path helpers now live in `@opencode-ai/core/util/fs-path` and are re-exported from `util/filesystem.ts`, so the namespace API is unchanged for callers. |
| `packages/gui/src/renderer/src/lib/store.ts` | `lib/session-api.ts` (fork-owned; renamed for accuracy — it is an API facade, not a store). |
| `packages/gui/src/renderer/src/lib/message-text.ts` | `packages/sdk/js/src/v2/client-message-text.ts` (unified with the TUI's copy). |
| Numbered GUI stylesheets (`styles/**/base-N.css`, `states-N.css`) | Renamed to semantic names (fork-owned; listed in `git log -M --diff-filter=R`). |
