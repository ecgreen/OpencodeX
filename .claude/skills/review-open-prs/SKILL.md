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
(oldest first: every marked review body at the current head, or, on new
commits, every body at the latest previously reviewed head), `selfAuthored`
(whether this PR was opened by the account the review posts as), and for
re-reviews a `priorReview` object holding the latest previous review.

One review per head SHA. A commit that has already been reviewed and that
nothing has happened to since is skipped — `reason: "awaiting author"` — no
matter how many cycles run over it. A PR comes back only when something
actually changed: new commits, the author replying, or CI arriving where
there was none. Re-reading unchanged code and posting a second verdict on it
is noise to the author, whatever the second read turns up.

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

Give each subagent this prompt, substituting the bracketed values. Which
prior-context block to append is selected by exactly one thing — the
decision's `reason` — never by the raw `nextPass` number and never by a
second, independently-computed condition on `priorBodies`:

```
Review pull request #<number> on ecgreen/OpencodeX: "<title>".

Read .claude/skills/review-open-prs/review-rubric.md and follow it exactly.

Reason this PR is being reviewed: <reason>
CI presence for the current head: <ci>
Record pass=<nextPass> in your marker.

<If selfAuthored is true, append:>
You authored this PR. GitHub rejects --request-changes on your own pull
request, so post with --comment whatever your verdict, exactly as the
rubric's Posting section describes.

<Now select the block below whose condition matches <reason>, and append it.
"no prior review" matches none of them — there is no prior context to hand
over — so for that reason append nothing here. The remaining three reasons
are mutually exclusive and each matches exactly one block:>

<If reason is "new commits since last review", append:>
This is a re-review after new commits. Every automated review posted at the
latest previously reviewed head SHA is included below, oldest first. Resolve
every finding across them as Fixed, Still open, or New:

<For each body in priorBodies, in order, append:>
Pass <index + 1>:
<body>

<If reason is "author replied since last review" or "CI arrived after last
review", append:>
This review was prompted by <"the author's reply" if reason is "author
replied since last review", else "CI arriving"> at this same head SHA, not by
new commits. Every automated review already posted at this exact head SHA is
included below, oldest first — there may be more than one:

<For each body in priorBodies, in order, append:>
Pass <index + 1>:
<body>

Do your own independent evidence gathering and reach your own conclusions
first. Do not defer to the passes above, and do not treat their silence on a
topic as evidence it is clean — a pass that did not mention something usually
did not check it. <If reason is "author replied since last review":>
Then address what the author said in their reply.

Carry every still-unresolved finding from every prior pass forward the way the
rubric's "Carrying findings forward without repeating them" section requires:
one line each under "Since the last review", never a second copy of their
prose. Your Blocking / Non-blocking / Nits sections hold only what is new at
this head SHA. The verdict and the counts still cover the union, so a
carried-forward blocking finding keeps the verdict at Request changes.

<If --dry-run was passed, append:>
DRY RUN: do not post. Write the complete review body to
.artifacts/pr-review/pr-<number>-review.md, then return the JSON with
"posted": false and "bodyPath": ".artifacts/pr-review/pr-<number>-review.md".
```

`priorBodies` is empty only for `reason: "no prior review"`. For new commits it
contains all bodies from the latest previously reviewed head, including the
original prose for findings a later pass may carry by label alone. For a
same-head trigger it contains all bodies at the current head. A force-push
back onto a reviewed commit prefers that commit's own reviews over newer
reviews at an abandoned SHA. These cases are covered by
`packages/script/test/pr-review-select.test.ts`. Never interpolate
`priorBodies[0]` alone: every place that reads `priorBodies` iterates the whole
array.

A subagent that errors or returns nothing marks that PR `error` in the summary.
Do not retry it this cycle — the next cycle picks it up naturally, because no
marker was written.

### 3. Verify what was posted

For each subagent that reported `"posted": true`, confirm *this cycle's*
review landed — not merely that some review of yours exists:

```bash
gh pr view <number> --repo ecgreen/OpencodeX --json reviews --jq '.reviews[-1].body' | head -1
```

Expected: a marker line carrying both this PR's current head SHA and
`pass=<nextPass>` — the values the dispatch prompt handed the subagent. If the
last review's marker is missing, or carries a different SHA or pass, mark that
PR `error`: the subagent claimed a post that did not happen.

Checking authorship alone is not enough, and fails on exactly the PRs that need
it most. Every re-review reason — `"author replied since last review"`,
`"CI arrived after last review"`, `"new commits since last review"` — by
construction already has an `ecgreen` review sitting on the PR. If the new
post silently fails, an authorship check reads the *previous* pass and passes.
It has force only on `"no prior review"`, the one case where a silent failure
costs least, because the next cycle re-selects the PR anyway.

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
