# PR Review Rubric

You are reviewing exactly one pull request on `ecgreen/OpencodeX`. Produce one
review. Do not modify any code, branch, or working tree.

## Evidence to gather first

1. `gh pr view <n> --repo ecgreen/OpencodeX --json title,body,author,headRefOid,statusCheckRollup`
   — the stated goals and the CI rollup.
2. `gh pr diff <n> --repo ecgreen/OpencodeX` — the change itself.
3. Full-file context for every touched file, at the PR head:
   ```
   git fetch origin pull/<n>/head:refs/pr-review/<n> --force
   git show refs/pr-review/<n>:<path>
   ```
   Never check out, never switch branches, never create a worktree, never run
   an install. The primary checkout usually holds uncommitted work.
4. `AGENTS.md` and `CONTRIBUTING.md`.
5. For every job whose `conclusion` is `FAILURE`:
   `gh run view <runId> --repo ecgreen/OpencodeX --log-failed | tail -100`.
   Get `<runId>` from the rollup entry's `detailsUrl`.
6. If you were given a prior review body, read it before judging anything.

Do not run tests, typecheck, or builds locally. CI already ran `static`,
`unit` on Linux and Windows, `cli-subprocess` on both, `gui-e2e`, and
`packaged-gui`. Reading those results is the CI check.

## The five dimensions

1. **Goals.** Does the diff accomplish what the PR body claims? Separately:
   does it change anything the PR does not claim to change? Unstated scope
   creep is a finding.

2. **CI.** Report each job's conclusion. For every failure, read the log and
   attribute it — caused by this PR, or pre-existing/flaky on `main`. A job
   that is also red on `main` is reported as such and is not counted against
   the author. If the rollup was empty, say so explicitly: "No CI run exists
   for this commit."

3. **Bugs.** Correctness: edge cases, error paths, race conditions,
   regressions, and cross-platform behavior. Windows especially — this repo
   ships Windows `cli-subprocess` and `packaged-gui` jobs, and POSIX-only
   assumptions about path separators, signals, and process spawning are a
   recurring real defect class here.

4. **Code issues.** Duplication, dead code, changed behavior with no test
   covering it, needless complexity.

5. **Guidelines.** The `AGENTS.md` style guide: no preemptively extracted
   single-use helpers, avoid `try`/`catch`, avoid `any`, keep logic at the call
   site unless genuinely reused. Conventional-commit PR title
   (`type(scope): summary`, types `feat|fix|docs|chore|refactor|test`). Plus
   the repo-specific invariants `AGENTS.md` documents — notably the GUI
   transcript scroll rules, which forbid reintroducing settle loops,
   submit-time prompt-follow scrolling, first-visible-message prepend anchors,
   multi-frame restore loops, and smooth automatic transcript scrolling.

## Severity

- **Blocking** — incorrect behavior, data loss, a CI failure attributable to
  this PR, a violation of a rule `AGENTS.md` states as hard, or the PR not
  doing what it claims.
- **Non-blocking** — real but tolerable: missing test, awkward structure, an
  unhandled unlikely edge case.
- **Nit** — naming, wording, formatting preference.

Verdict is mechanical: **any** Blocking finding means request changes.
Otherwise, comment. Never approve.

## Review body template

Write exactly this structure. `<SHA>` is the PR's current `headRefOid`;
`<CI>` is `present` if the rollup had any entry, otherwise `absent`.

````markdown
<!-- opencodex-pr-review sha=<SHA> ci=<CI> -->
**Verdict:** <Request changes|Looks good> — <N> blocking, <N> non-blocking, <N> nits

| Goals | CI | Bugs | Code | Guidelines |
|-------|----|------|------|------------|
| OK | FAIL unit (linux, windows) | 2 | 3 | OK |

### Since the last review
- Fixed: <prior finding that is now resolved>
- Still open: <prior finding that remains>
- New: <problem introduced since the last review>

### Blocking
1. `path/to/file.ts:142` — what is wrong, why it is wrong, what breaks.

### Non-blocking
1. `path/to/file.ts:88` — ...

### Nits
1. `path/to/file.ts:12` — ...
````

Rules for the template:
- The marker line is mandatory and must be the first line.
- Include the "Since the last review" section **only** when you were given a
  prior review body. Every finding from that prior review must appear in it as
  exactly one of Fixed / Still open / New.
- Omit any of Blocking / Non-blocking / Nits that is empty.
- If there are no findings at all, keep the marker, the verdict line, and the
  table, then write a one-paragraph summary of what the PR does and why it
  looks correct.
- Every finding cites `file:line`. No inline PR comments — this is one review
  body.

## Posting

Write the body to a file in the session scratchpad, never into the repo. Then:

```
gh pr review <n> --repo ecgreen/OpencodeX --request-changes --body-file <path>
gh pr review <n> --repo ecgreen/OpencodeX --comment --body-file <path>
```

Use `--request-changes` when there is at least one Blocking finding, otherwise
`--comment`. Never `--approve`.

## What to return

Return one line of JSON and nothing else:

```json
{"number": 25, "verdict": "request_changes", "blocking": 2, "nonBlocking": 3, "nits": 1, "posted": true}
```

Set `"posted": false` and add `"error": "<message>"` if posting failed.
