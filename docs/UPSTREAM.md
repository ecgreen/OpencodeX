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
