# Automated Open-PR Review Skill

**Date:** 2026-08-19
**Status:** Approved design, pending implementation

## Problem

Open PRs on `ecgreen/OpencodeX` accumulate faster than they get reviewed. Review
state is inconsistent: some PRs have a `CHANGES_REQUESTED` review with follow-up
work already pushed that nobody has looked at again, others have never been
reviewed at all. Checking this by hand every hour is not something a person will
actually keep doing.

We want a skill that, on demand and on an hourly loop, finds the PRs whose code
has moved since the last review and posts a review covering five specific
questions.

## Goals

For each eligible open PR, answer and report on:

1. Does the PR accomplish its stated goals?
2. Does it pass CI?
3. Does it introduce bugs?
4. Are there other issues in the code?
5. Does the code follow the repo's guidelines?

Skip PRs that already carry an unaddressed review. Re-review PRs where follow-up
work landed after the last review.

## Non-Goals

- Running the test suite, typecheck, or build locally. CI already runs `static`,
  `unit` on Linux and Windows, `cli-subprocess` on both, `gui-e2e`, and
  `packaged-gui`; reading those results is the CI check.
- Approving or merging PRs. The skill never submits `APPROVE`.
- Reviewing upstream (`anomalyco/opencode`) PRs.
- Inline (line-anchored) PR comments. Deferred; see Future Work.
- Pushing fixes, or modifying any PR branch.

## Context

- `origin` is `https://github.com/ecgreen/OpencodeX.git`; `upstream` is
  `https://github.com/anomalyco/opencode.git` with push disabled.
- A bare `gh pr list` in this checkout resolves to **upstream**, returning
  40,000+ unrelated PRs. Every `gh` invocation in this skill must pass
  `--repo ecgreen/OpencodeX` explicitly. This is the single highest-risk detail
  in the design.
- Reviews are submitted as `ecgreen`. Most open PRs are authored by
  `omgoshjosh`, and for those GitHub permits `REQUEST_CHANGES`. It refuses any
  non-`COMMENT` review on your own PR, though, and `ecgreen` authors PRs here
  too — so authorship is decided per PR at runtime (`Decision.selfAuthored`)
  rather than assumed. A self-authored PR is still reviewed; it is posted with
  `--comment` whatever the verdict, which keeps the marker landing and the
  cycle converging. Assuming the two accounts always differ is what left the
  first `ecgreen`-authored PR unable to complete a review at all.
- Repo guidelines live in `AGENTS.md` and `CONTRIBUTING.md`.
- CI is `.github/workflows/ci.yml`.

## Architecture

A project-scoped skill at `.claude/skills/review-open-prs/SKILL.md`, invoked as
`/review-open-prs [--dry-run]`. Hourly operation is `/loop 1h /review-open-prs`
— no cron, no GitHub Action, no secrets. The skill runs only while Claude Code
is open, which is the stated requirement; newly opened PRs are picked up by the
next hourly poll.

Two components:

- **Cycle orchestrator** (main session): enumerates PRs, applies the gate chain,
  dispatches subagents, prints the summary table. Holds no PR diffs.
- **PR review subagent** (one per eligible PR, max 5 concurrent): gathers
  evidence for a single PR, applies the rubric, posts one review. Gets a clean
  context so a large diff cannot crowd out the rubric.

The split exists so the orchestrator's context stays small and constant
regardless of how many PRs are in flight, and so one PR's failure cannot abort
the cycle.

## Cycle Orchestrator

### Input

One call:

```
gh pr list --repo ecgreen/OpencodeX --state open --limit 50 \
  --json number,title,isDraft,headRefOid,commits,reviews,comments,statusCheckRollup
```

### Gate chain

Each PR passes through these in order. The first gate that matches decides.

1. **Draft** — `isDraft == true` -> `skipped (draft)`.

2. **CI incomplete** — any entry in `statusCheckRollup` with
   `status != "COMPLETED"` -> `deferred (CI running)`. The PR is reconsidered
   next cycle. Reviewing before CI settles would mean reporting "CI: unknown" on
   the one dimension CI is authoritative for.

   *Escape hatch:* if `statusCheckRollup` is empty **and** the head commit is
   more than 20 minutes old, do not defer. Review the PR and state in the review
   body that no CI run exists for this commit. Without this, a PR whose workflow
   never triggered would be deferred forever.

3. **Already reviewed at this code** — find the most recent review authored by
   `ecgreen` whose body contains `<!-- opencodex-pr-review sha=... ci=... -->`.
   Skip as `skipped (awaiting author)` only if all three hold:
   - the marker's SHA equals the current `headRefOid`;
   - no comment by the PR author postdates that review's `submittedAt`;
   - the marker does not say `ci=absent` while `statusCheckRollup` is now
     populated.

   The third condition exists because gate 2's escape hatch can review a PR
   whose CI had not yet registered. Without it, that review's "no CI run
   exists" note would stick permanently, since the SHA never changes once CI
   arrives late. Recording `ci=absent|present` in the marker lets exactly that
   one case re-review.

4. **Otherwise** -> eligible for review. The head SHA changed, or the author
   responded, or there is no prior review.

### Why the SHA marker, not timestamps

Comparing the last review's `submittedAt` against the head commit's
`committedDate` is wrong under rebase and amend, both of which preserve or
rewrite commit dates backwards. A PR force-pushed with an older `committedDate`
would be permanently skipped despite carrying new code. Head SHA identity is
exact: a different SHA means different code, always.

The marker is written into the review body at post time as an HTML comment, so
it renders invisibly on GitHub while remaining greppable from the API.

### Dispatch

Eligible PRs are dispatched to review subagents, at most 5 concurrent. A
subagent that errors marks its PR `error` in the summary and posts nothing; the
cycle continues and the next cycle retries that PR naturally, since no marker
was written.

### Output

One table per cycle:

```
PR    Title                                    Action     Verdict           Findings
#25   fix(opencode): preserve goal graph...    reviewed   request changes   2B 3N 1n
#23   fix(opencode): use file times for...     skipped    awaiting author   -
#22   docs: define mobile child interaction    deferred   CI running        -
```

Counts are Blocking / Non-blocking / nit. An hourly tick where nothing changed
is a few lines, not a wall of text.

## PR Review Subagent

### Evidence gathering

1. PR title and body — the stated goals, plus any linked issue.
2. The diff: `gh pr diff <n> --repo ecgreen/OpencodeX`.
3. Full-file context for every touched file, at the PR head.
4. `AGENTS.md` and `CONTRIBUTING.md`.
5. Per-job CI conclusions from `statusCheckRollup`.
6. For each failing job, the failure tail via `gh run view --log-failed`.
7. On re-review: the previous review body, parsed for its findings list.

### Obtaining PR code without touching the working tree

```
git fetch origin pull/<n>/head:refs/pr-review/<n> --force
git show refs/pr-review/<n>:<path>
```

No checkout, no worktree, no `git switch`, no dependency install. The user
routinely has uncommitted work in the primary checkout, and a stray full clone
(`.tmp-pr14-review/`) from a previous manual review is exactly the artifact this
avoids. Refs are reused per PR and force-updated, so the repo accumulates at
most one ref per open PR.

### Rubric

Findings are produced under five headings, matching the goals above.

1. **Goals.** Does the diff accomplish what the PR body claims? Separately: does
   it change things the PR does not claim to change? Unstated scope creep is a
   finding.

2. **CI.** Report each job's conclusion. For every failure, read the log and
   attribute it: caused by this PR, or pre-existing/flaky on `main`. A job that
   is also red on `main` is reported as such and does not count against the
   author.

3. **Bugs.** Correctness: edge cases, error paths, race conditions, regressions,
   and cross-platform behavior. Windows specifically — this repo ships Windows
   `cli-subprocess` and `packaged-gui` jobs, and POSIX-only assumptions (path
   separators, signals, process spawning) are a recurring real defect class
   here.

4. **Code issues.** Duplication, dead code, changed behavior with no test
   covering it, needless complexity.

5. **Guidelines.** The `AGENTS.md` style guide — no preemptively extracted
   single-use helpers, avoid `try`/`catch`, avoid `any`, keep logic at the call
   site unless genuinely reused. Conventional-commit PR title
   (`type(scope): summary`, types `feat|fix|docs|chore|refactor|test`). Plus the
   repo-specific invariants `AGENTS.md` documents, notably the GUI transcript
   scroll rules, which forbid reintroducing settle loops, submit-time
   prompt-follow scrolling, prepend anchors, multi-frame restore loops, or
   smooth automatic transcript scrolling.

### Severity and verdict

Every finding is `Blocking`, `Non-blocking`, or `Nit`.

- `Blocking`: incorrect behavior, data loss, a CI failure attributable to this
  PR, a guideline violation the repo states as a hard rule, or the PR not doing
  what it claims.
- `Non-blocking`: real but tolerable — missing test, awkward structure,
  unhandled unlikely edge case.
- `Nit`: naming, wording, formatting preference.

Verdict is mechanical: **any** Blocking finding -> `REQUEST_CHANGES`. Otherwise
-> `COMMENT`. `APPROVE` is never submitted; a human signs off before merge.

### Review body format

```markdown
<!-- opencodex-pr-review sha=efa8c2ad2cc604ee64195c4acb5091d24ead7342 ci=present -->
**Verdict:** Request changes — 2 blocking, 3 non-blocking, 1 nit

| Goals | CI | Bugs | Code | Guidelines |
|-------|----|------|------|------------|
| OK | FAIL unit (linux, windows) | 2 | 3 | OK |

### Since the last review
- Fixed: temp-file image path replaced with native content blocks
- Still open: no test covers the empty-attachment case
- New: `patchSessionData` now swallows a rejected promise

### Blocking
1. `packages/core/src/foo.ts:142` — what is wrong, why, what breaks

### Non-blocking
...

### Nits
...
```

The "Since the last review" section appears only on re-reviews. Findings cite
`file:line`.

### Posting

```
gh pr review <n> --repo ecgreen/OpencodeX --request-changes --body-file <tmp>
gh pr review <n> --repo ecgreen/OpencodeX --comment         --body-file <tmp>
```

Bodies are written to the session scratchpad, never into the repo.

## Dry-run mode

`/review-open-prs --dry-run` runs the full cycle — gate chain, evidence
gathering, rubric, verdict — and prints each review body to the terminal instead
of submitting it. Nothing is posted and no marker is written, so a subsequent
real run treats every PR as unreviewed. Intended for verifying the skill's
judgment before letting it post unattended, and for spot-checking after rubric
edits.

## Error handling

| Condition | Behavior |
|---|---|
| No open PRs | Print one line, exit. |
| All PRs skipped or deferred | Print the table, exit. |
| `gh` not authenticated | Fail the cycle loudly. Post nothing. |
| GitHub rate limit | Fail the cycle loudly. Post nothing partial. |
| `git fetch` of a PR head fails | That PR -> `error`. Cycle continues. |
| Subagent errors or returns nothing | That PR -> `error`, no review posted, no marker. Retried next cycle. |
| Review post rejected by GitHub | That PR -> `error`, surfaced with the API message. |

## Safety boundaries

The skill posts to GitHub without per-PR confirmation — that is the point of
unattended hourly operation — bounded as follows:

- Only `ecgreen/OpencodeX`. Never upstream.
- Only `COMMENT` and `REQUEST_CHANGES` reviews. Never `APPROVE`.
- Never merges, closes, labels, or pushes.
- Never modifies the working tree or any PR branch.
- `--dry-run` posts nothing at all.

## Testing

- **Gate chain** is the part with real logic, verified against live PR state at
  implementation time: #25 (no review, CI complete, `unit` failing -> review),
  #16 (`CHANGES_REQUESTED` plus newer commits -> re-review), a freshly-reviewed
  PR (-> skip), a draft (-> skip), a PR with CI in flight (-> defer).
- **Rebase case**: re-point a test PR at a rebased head with an older
  `committedDate` and confirm the SHA marker still triggers re-review.
- **End-to-end** is exercised via `--dry-run` across all open PRs before the
  first live run.

## Future Work

- Inline line-anchored review comments. Requires diff-hunk position mapping
  through the reviews API; a partially-anchored review is worse than a
  well-referenced body, so this is deliberately out of v1.
- Escalation to `/code-review ultra <PR#>` for PRs the skill flags as high-risk,
  run manually.
- A scheduled cloud agent calling the same skill, if unattended overnight
  reviews become desirable.
