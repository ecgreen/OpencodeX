---
name: review-open-prs
description: Use when reviewing open pull requests on ecgreen/OpencodeX - checks whether each PR meets its stated goals, passes CI, introduces bugs, has code issues, or breaks repo guidelines, then posts a GitHub review. Skips PRs already reviewed at their current head. Run on demand as /review-open-prs, or hourly via /loop 1h /review-open-prs.
---

# Review Open PRs

Reviews every open PR on `ecgreen/OpencodeX` whose code has moved since the last
review, and posts one GitHub review per PR.

**Announce at start:** "Using review-open-prs to review open PRs on
ecgreen/OpencodeX."

## Arguments

- `--dry-run` — do everything except post. Each subagent writes its review
  body to a file under `.artifacts/pr-review/` instead of posting; the
  orchestrator reads those files back and prints them. No marker is written,
  so a later real run treats every PR as unreviewed.

## Hard boundaries

- Only `ecgreen/OpencodeX`. A bare `gh` command in this checkout resolves to
  `upstream` (`anomalyco/opencode`) — every call needs `--repo`.
- Only `--comment` and `--request-changes` reviews. Never `--approve`.
- Never merge, close, label, push, or modify a PR branch.
- Never modify the working tree, switch branches, or create a worktree.

## Procedure

### 1. Select

Run:

```bash
bun run --cwd packages/script pr-review:select
```

This prints a JSON array of decisions, one per open PR, each with `number`,
`title`, `action` (`review` | `skip` | `defer`), `reason`, `ci`, `nextPass`
(the pass number the review about to be written should record), `priorBodies`
(the bodies of every prior marked review at the current head SHA, oldest
first — empty if none), and for re-reviews a `priorReview` object holding the
previous review `body`.

Every PR is sampled twice at each head SHA before it goes quiet: live
measurement showed a single review pass catches roughly one in three
blocking findings that require comparing the diff against state outside the
PR itself (e.g. "this diff is byte-identical to code already on `main`", or
"this changes the client's identity to impersonate another tool"). A `reason`
of `"second pass"` means the PR's current head has exactly one prior marked
review and needs its independent second look before it can be skipped.

Do not second-guess these decisions. The gate chain is unit tested in
`packages/script/test/pr-review-select.test.ts`; re-deriving it by hand each
cycle is exactly the non-determinism this command exists to remove.

If the command fails because `gh` is unauthenticated or rate limited, stop the
whole cycle and report it. Post nothing.

If no decision has `action: "review"`, print the summary table from step 4 and
stop.

### 2. Dispatch

For each decision with `action: "review"`, dispatch one subagent. Run at most 5
concurrently; if there are more, run them in batches of 5.

On `--dry-run`, first create the output directory:

```bash
mkdir -p .artifacts/pr-review
```

(`.artifacts/` is git-ignored — `.gitignore:37`, pattern `**/.artifacts/` — so
writing review bodies there does not violate the "never modify the working
tree" boundary.) Assign each PR its own output path,
`.artifacts/pr-review/pr-<number>-review.md`.

Give each subagent this prompt, substituting the bracketed values:

```
Review pull request #<number> on ecgreen/OpencodeX: "<title>".

Read .claude/skills/review-open-prs/review-rubric.md and follow it exactly.

Reason this PR is being reviewed: <reason>
CI presence for the current head: <ci>
This is pass <nextPass> of at most 2 for this head SHA. Record pass=<nextPass>
in your marker.

<If priorReview exists, append:>
This is a re-review. Here is the review you are following up on. Resolve every
finding in it as Fixed, Still open, or New:

<priorReview.body>

<If priorBodies is non-empty (nextPass is 2), append:>
This is the second independent pass at this exact head SHA. Here is the first
pass's review body:

<priorBodies[0]>

Do your own evidence gathering and reach your own conclusions before you look
at this. This second pass exists precisely because a single pass's recall on
findings that require comparing the diff against state outside the PR itself
— code already on `main`, another tool's identity, prior repo history — is
roughly one in three: the first pass genuinely misses real things, and its
silence on a topic is not evidence that topic is clean. Do not defer to the
first pass or treat it as authoritative. Once you have your own independent
findings, include any first-pass finding you independently agree with. Your
posted review's Blocking section must be the union of every blocking finding
either pass found — never drop a first-pass blocking finding just because
your own pass didn't reproduce it.

<If --dry-run was passed, append:>
DRY RUN: do not post. Write the complete review body to
.artifacts/pr-review/pr-<number>-review.md, then return the JSON with
"posted": false and "bodyPath": ".artifacts/pr-review/pr-<number>-review.md".
```

A subagent that errors or returns nothing marks that PR `error` in the summary.
Do not retry it this cycle — the next cycle picks it up naturally, because no
marker was written.

### 3. Verify what was posted

For each subagent that reported `"posted": true`, confirm the review landed:

```bash
gh pr view <number> --repo ecgreen/OpencodeX --json reviews \
  --jq '.reviews[-1] | "\(.author.login) \(.state)"'
```

Expected: `ecgreen COMMENTED` or `ecgreen CHANGES_REQUESTED`. If the last review
is not yours, mark that PR `error` — the subagent claimed a post that did not
happen.

Skip this step entirely on `--dry-run`.

### 4. Report

Print one table for the cycle, nothing more:

```
PR    Title                                    Action     Verdict           Findings
#25   fix(opencode): preserve goal graph...    reviewed   request changes   2B 3N 1n
#24   fix(gui): debounce resize handler...     reviewed   comment           0B 2N 1n
#23   fix(opencode): use file times for...     skipped    awaiting author   -
#22   docs: define mobile child interaction    deferred   CI running        -
#16   fix(swarm): stop dropping image atta...  error      -                 -
```

Truncate titles to fit. Counts are Blocking / Non-blocking / nit. For
`reviewed` rows, Verdict is exactly `request changes` or `comment`, matching
the subagent's returned `"verdict"` value — never a body-only phrase like
"Looks good with notes". Do not reproduce review bodies in the terminal on a
real run — they are on GitHub. On `--dry-run`, read each body from the
`"bodyPath"` its subagent returned and print it in full above the table.

Under `/loop`, a cycle where nothing changed should be this table and nothing
else.

## Errors

| Condition | Behavior |
|---|---|
| No open PRs | Print one line, exit. |
| All PRs skipped or deferred | Print the table, exit. |
| `gh` unauthenticated or rate limited | Fail the cycle loudly. Post nothing. |
| `git fetch` of a PR head fails | That PR is `error`. Cycle continues. |
| Subagent errors or returns nothing | That PR is `error`. No marker written. Retried next cycle. |
| Review post rejected by GitHub | That PR is `error`, surfaced with the API message. |
