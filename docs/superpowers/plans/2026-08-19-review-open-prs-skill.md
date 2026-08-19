# Open-PR Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/review-open-prs`, a project skill that reviews open PRs on `ecgreen/OpencodeX` against five dimensions and posts a GitHub review, skipping PRs whose code has not moved since the last review.

**Architecture:** The deterministic part — deciding which PRs need review — is a pure TypeScript module in `packages/script` with unit tests, exposed through a thin CLI that shells out to `gh` and prints JSON decisions. The judgment part — actually reading a diff and writing findings — lives in `.claude/skills/review-open-prs/`, where the skill orchestrates one review subagent per eligible PR. Splitting it this way means the gate chain is testable and identical every cycle, while the model only does what models are good at.

**Tech Stack:** Bun + TypeScript, `bun:test`, GitHub CLI (`gh`), Claude Code project skills.

**Spec:** `docs/superpowers/specs/2026-08-19-pr-review-skill-design.md`

## Global Constraints

- Every `gh` invocation MUST pass `--repo ecgreen/OpencodeX`. A bare `gh` command in this checkout resolves to the `upstream` remote (`anomalyco/opencode`) and would act on strangers' PRs.
- Never submit `APPROVE`. Only `--comment` and `--request-changes`.
- Never merge, close, label, push, or modify any PR branch.
- Never modify the working tree, switch branches, or create worktrees. PR code is read via `git fetch origin pull/<n>/head:refs/pr-review/<n> --force` plus `git show`.
- Repo style guide (`AGENTS.md`): avoid `try`/`catch`; avoid the `any` type; do not extract single-use helpers — inline logic at the call site unless it is genuinely reused.
- Commit messages and PR titles are conventional: `type(scope): summary`, types `feat|fix|docs|chore|refactor|test`.
- The reviewer account is `ecgreen`. The review marker is `<!-- opencodex-pr-review sha=<headRefOid> ci=present|absent -->`.
- Root `bun test` is disabled by `bunfig.toml` (`[test] root = "./do-not-run-tests-from-root"`). Tests must run from inside a workspace package.

---

### Task 1: Pure gate-chain selection module

The decision logic, with no I/O. This is the only part of the system with real branching, so it gets real tests.

**Files:**
- Create: `packages/script/src/pr-review-select.ts`
- Create: `packages/script/test/pr-review-select.test.ts`
- Modify: `packages/script/package.json` (add `test` and `test:ci` scripts)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `decidePullRequest(pr: PullRequestSnapshot, now: Date): Decision`, `parseMarker(body: string): Marker | undefined`, `formatMarker(sha: string, ci: CiPresence): string`, the constants `NO_CI_GRACE_MS`, `REVIEWER_LOGIN`, `REVIEW_REPO`, and the types `PullRequestSnapshot`, `Decision`, `DecisionAction`, `PriorReview`, `Marker`, `CiPresence`, `CheckRun`, `ReviewRecord`, `CommentRecord`. Task 2 imports `decidePullRequest`, `REVIEW_REPO`, `CheckRun`, and `PullRequestSnapshot`.

- [ ] **Step 1: Add test scripts to the script package**

The package currently has only `typecheck`. Copy the pattern `github/package.json` already uses, so the generic turbo `test:ci` task picks it up and it runs in the CI `unit` matrix on Linux and Windows.

In `packages/script/package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "typecheck": "tsgo --noEmit",
    "test": "bun test test",
    "test:ci": "mkdir -p .artifacts/unit && bun test test --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml"
  },
```

- [ ] **Step 2: Confirm `.artifacts` is git-ignored**

Run: `git check-ignore -v packages/script/.artifacts/unit/junit.xml`

Expected: a line naming the ignore rule (non-empty output, exit 0). If output is empty, append `.artifacts/` to `packages/script/.gitignore`, creating that file if needed.

- [ ] **Step 3: Write the failing tests**

Create `packages/script/test/pr-review-select.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  decidePullRequest,
  formatMarker,
  parseMarker,
  NO_CI_GRACE_MS,
  type PullRequestSnapshot,
} from "../src/pr-review-select"

const NOW = new Date("2026-08-19T12:00:00Z")
const SHA = "efa8c2ad2cc604ee64195c4acb5091d24ead7342"
const OTHER_SHA = "1111111111111111111111111111111111111111"

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    number: 25,
    title: "fix(opencode): preserve goal graph dispatch context",
    authorLogin: "omgoshjosh",
    isDraft: false,
    headRefOid: SHA,
    headCommittedAt: "2026-08-19T10:00:00Z",
    reviews: [],
    comments: [],
    checks: [{ name: "unit (linux)", status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-08-19T10:05:00Z" }],
    ...overrides,
  }
}

function review(body: string, submittedAt: string, authorLogin = "ecgreen") {
  return { authorLogin, body, submittedAt }
}

describe("parseMarker", () => {
  test("reads sha and ci presence", () => {
    expect(parseMarker(`<!-- opencodex-pr-review sha=${SHA} ci=present -->\nbody`)).toEqual({
      sha: SHA,
      ci: "present",
    })
  })

  test("returns undefined without a marker", () => {
    expect(parseMarker("Looks good to me")).toBeUndefined()
  })

  test("returns undefined for a malformed marker", () => {
    expect(parseMarker("<!-- opencodex-pr-review sha=zzz ci=maybe -->")).toBeUndefined()
  })

  test("round-trips with formatMarker", () => {
    expect(parseMarker(formatMarker(SHA, "absent"))).toEqual({ sha: SHA, ci: "absent" })
  })
})

describe("decidePullRequest", () => {
  test("skips drafts", () => {
    const decision = decidePullRequest(snapshot({ isDraft: true }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("draft")
  })

  test("defers while any check is still running", () => {
    const checks = [
      { name: "unit (linux)", status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-08-19T10:05:00Z" },
      { name: "gui e2e (chromium)", status: "IN_PROGRESS", conclusion: null, completedAt: null },
    ]
    const decision = decidePullRequest(snapshot({ checks }), NOW)
    expect(decision.action).toBe("defer")
    expect(decision.reason).toContain("gui e2e (chromium)")
  })

  test("defers a fresh commit with no checks yet", () => {
    const headCommittedAt = new Date(NOW.getTime() - NO_CI_GRACE_MS + 60_000).toISOString()
    const decision = decidePullRequest(snapshot({ checks: [], headCommittedAt }), NOW)
    expect(decision.action).toBe("defer")
    expect(decision.reason).toBe("CI not yet registered")
  })

  test("reviews an old commit that never got checks", () => {
    const headCommittedAt = new Date(NOW.getTime() - NO_CI_GRACE_MS - 60_000).toISOString()
    const decision = decidePullRequest(snapshot({ checks: [], headCommittedAt }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("no prior review")
  })

  test("reviews a PR with no prior review", () => {
    expect(decidePullRequest(snapshot(), NOW).action).toBe("review")
  })

  test("reviews a PR whose completed CI concluded in failure", () => {
    const checks = [
      { name: "unit (linux)", status: "COMPLETED", conclusion: "FAILURE", completedAt: "2026-08-19T10:05:00Z" },
    ]
    const decision = decidePullRequest(snapshot({ checks }), NOW)
    expect(decision.action).toBe("review")
  })

  test("skips when the marker matches head and the author has not replied", () => {
    const reviews = [review(formatMarker(SHA, "present"), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("awaiting author")
    expect(decision.priorReview?.sha).toBe(SHA)
  })

  test("re-reviews when the head sha moved", () => {
    const reviews = [review(formatMarker(OTHER_SHA, "present"), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("new commits since last review")
  })

  test("skips when an abbreviated marker prefix-matches the current head", () => {
    const reviews = [review(formatMarker(SHA.slice(0, 7), "present"), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("awaiting author")
  })

  test("re-reviews after a rebase that backdates the head commit", () => {
    const reviews = [review(formatMarker(OTHER_SHA, "present"), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews, headCommittedAt: "2026-08-01T00:00:00Z" }), NOW)
    expect(decision.action).toBe("review")
  })

  test("re-reviews when the PR author replied after the review", () => {
    const reviews = [review(formatMarker(SHA, "present"), "2026-08-19T11:00:00Z")]
    const comments = [{ authorLogin: "omgoshjosh", createdAt: "2026-08-19T11:30:00Z" }]
    const decision = decidePullRequest(snapshot({ reviews, comments }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("author replied since last review")
  })

  test("ignores comments from anyone but the PR author", () => {
    const reviews = [review(formatMarker(SHA, "present"), "2026-08-19T11:00:00Z")]
    const comments = [{ authorLogin: "ecgreen", createdAt: "2026-08-19T11:30:00Z" }]
    expect(decidePullRequest(snapshot({ reviews, comments }), NOW).action).toBe("skip")
  })

  test("re-reviews when CI arrived after a ci=absent review", () => {
    const reviews = [review(formatMarker(SHA, "absent"), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("CI arrived after last review")
  })

  test("still skips a ci=absent review while CI is still missing", () => {
    const reviews = [review(formatMarker(SHA, "absent"), "2026-08-19T11:00:00Z")]
    const headCommittedAt = new Date(NOW.getTime() - NO_CI_GRACE_MS - 60_000).toISOString()
    expect(decidePullRequest(snapshot({ reviews, checks: [], headCommittedAt }), NOW).action).toBe("skip")
  })

  test("ignores marked reviews from other accounts", () => {
    const reviews = [review(formatMarker(SHA, "present"), "2026-08-19T11:00:00Z", "someone-else")]
    expect(decidePullRequest(snapshot({ reviews }), NOW).action).toBe("review")
  })

  test("ignores unmarked human reviews", () => {
    const reviews = [review("Looks good, ship it", "2026-08-19T11:00:00Z")]
    expect(decidePullRequest(snapshot({ reviews }), NOW).action).toBe("review")
  })

  test("uses the most recent marked review when several exist", () => {
    const reviews = [
      review(formatMarker(OTHER_SHA, "present"), "2026-08-18T09:00:00Z"),
      review(formatMarker(SHA, "present"), "2026-08-19T11:00:00Z"),
    ]
    expect(decidePullRequest(snapshot({ reviews }), NOW).action).toBe("skip")
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun run --cwd packages/script test`

Expected: FAIL — `Cannot find module '../src/pr-review-select'`.

- [ ] **Step 5: Implement the module**

Create `packages/script/src/pr-review-select.ts`:

```ts
export const REVIEWER_LOGIN = "ecgreen"
export const REVIEW_REPO = "ecgreen/OpencodeX"
export const NO_CI_GRACE_MS = 20 * 60 * 1000

const MARKER_PATTERN = /<!--\s*opencodex-pr-review\s+sha=([0-9a-f]{7,40})\s+ci=(present|absent)\s*-->/

export type CiPresence = "present" | "absent"

export type Marker = {
  sha: string
  ci: CiPresence
}

export type CheckRun = {
  name: string
  status: string
  conclusion: string | null
  completedAt: string | null
}

export type ReviewRecord = {
  authorLogin: string
  body: string
  submittedAt: string
}

export type CommentRecord = {
  authorLogin: string
  createdAt: string
}

export type PullRequestSnapshot = {
  number: number
  title: string
  authorLogin: string
  isDraft: boolean
  headRefOid: string
  headCommittedAt: string
  reviews: ReviewRecord[]
  comments: CommentRecord[]
  checks: CheckRun[]
}

export type DecisionAction = "review" | "skip" | "defer"

export type PriorReview = Marker & {
  body: string
  submittedAt: string
}

export type Decision = {
  number: number
  title: string
  action: DecisionAction
  reason: string
  ci: CiPresence
  priorReview?: PriorReview
}

export function parseMarker(body: string): Marker | undefined {
  const match = MARKER_PATTERN.exec(body)
  if (!match) return undefined
  return { sha: match[1]!, ci: match[2] as CiPresence }
}

export function formatMarker(sha: string, ci: CiPresence): string {
  return `<!-- opencodex-pr-review sha=${sha} ci=${ci} -->`
}

// GitHub timestamps are all Z-suffixed ISO 8601 of identical width, so string
// comparison is chronological and avoids a Date allocation per comment.
export function decidePullRequest(pr: PullRequestSnapshot, now: Date): Decision {
  const base = { number: pr.number, title: pr.title }

  if (pr.isDraft) return { ...base, action: "skip", reason: "draft", ci: "absent" }

  const pending = pr.checks.filter((check) => check.status !== "COMPLETED")
  if (pending.length > 0) {
    const names = pending.map((check) => check.name).join(", ")
    return { ...base, action: "defer", reason: `CI running (${names})`, ci: "present" }
  }

  const ci: CiPresence = pr.checks.length > 0 ? "present" : "absent"
  if (ci === "absent" && now.getTime() - new Date(pr.headCommittedAt).getTime() < NO_CI_GRACE_MS) {
    return { ...base, action: "defer", reason: "CI not yet registered", ci }
  }

  let latest: PriorReview | undefined
  for (const record of pr.reviews) {
    if (record.authorLogin !== REVIEWER_LOGIN) continue
    const marker = parseMarker(record.body)
    if (!marker) continue
    if (latest && record.submittedAt <= latest.submittedAt) continue
    latest = { ...marker, body: record.body, submittedAt: record.submittedAt }
  }

  if (!latest) return { ...base, action: "review", reason: "no prior review", ci }

  // Rebind to a const: TypeScript drops the not-undefined narrowing of a `let`
  // inside the `pr.comments.some` callback below.
  const prior = latest

  // `prior.sha` may be an abbreviated marker (7-40 hex chars, see
  // MARKER_PATTERN), so this is a prefix test, not exact equality: a 7-char
  // marker matching the current head means "already reviewed", not "new
  // commits". The regex's 7-char floor makes a prefix collision negligible.
  if (!pr.headRefOid.startsWith(prior.sha))
    return { ...base, action: "review", reason: "new commits since last review", ci, priorReview: prior }

  const authorReplied = pr.comments.some(
    (comment) => comment.authorLogin === pr.authorLogin && comment.createdAt > prior.submittedAt,
  )
  if (authorReplied)
    return { ...base, action: "review", reason: "author replied since last review", ci, priorReview: prior }

  if (prior.ci === "absent" && ci === "present")
    return { ...base, action: "review", reason: "CI arrived after last review", ci, priorReview: prior }

  return { ...base, action: "skip", reason: "awaiting author", ci, priorReview: prior }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run --cwd packages/script test`

Expected: PASS, 21 tests.

- [ ] **Step 7: Typecheck**

Run: `bun run --cwd packages/script typecheck`

Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/script/src/pr-review-select.ts packages/script/test/pr-review-select.test.ts packages/script/package.json
git commit -m "feat(script): add open-PR review gate chain"
```

---

### Task 2: `gh` adapter CLI

Turns live GitHub state into `PullRequestSnapshot` values and prints decisions as JSON. Kept separate from Task 1 because everything here is I/O and cannot be unit tested meaningfully — it is verified by running it.

**Files:**
- Create: `packages/script/src/pr-review-select-cli.ts`
- Modify: `packages/script/package.json` (add `pr-review:select` script)

**Interfaces:**
- Consumes: `decidePullRequest`, `REVIEW_REPO`, and the types `PullRequestSnapshot`, `CheckRun`, `Decision` from `./pr-review-select`.
- Produces: the command `bun run --cwd packages/script pr-review:select`, printing `Decision[]` as JSON to stdout. Task 3's skill calls exactly this.

- [ ] **Step 1: Write the CLI**

Create `packages/script/src/pr-review-select-cli.ts`:

```ts
#!/usr/bin/env bun
import { $ } from "bun"
import { decidePullRequest, REVIEW_REPO, REVIEWER_LOGIN, type CheckRun, type PullRequestSnapshot } from "./pr-review-select"

// `statusCheckRollup` mixes CheckRun nodes (name/status/conclusion) with older
// StatusContext nodes (context/state), so both shapes are optional here.
type GhRollupEntry = {
  name?: string
  context?: string
  status?: string
  state?: string
  conclusion?: string | null
  completedAt?: string | null
}

type GhPullRequest = {
  number: number
  title: string
  author: { login: string } | null
  isDraft: boolean
  headRefOid: string
  commits: { committedDate: string }[]
  reviews: { author: { login: string } | null; body: string | null; submittedAt: string }[]
  comments: { author: { login: string } | null; createdAt: string }[]
  statusCheckRollup: GhRollupEntry[] | null
}

// If the authenticated `gh` account ever drifts from REVIEWER_LOGIN, every
// marker posted from here on becomes invisible to the next pass's identity
// check on GitHub review authorship, reproducing the unbounded re-review bug
// this selection module otherwise guards against. Fail loudly before listing
// anything.
const authenticatedLogin = (await $`gh api user --jq .login`.text()).trim()
if (authenticatedLogin !== REVIEWER_LOGIN) {
  console.error(
    `error: gh is authenticated as "${authenticatedLogin}", but reviews are posted as "${REVIEWER_LOGIN}". ` +
      "Re-authenticate gh as the correct account before running this again.",
  )
  process.exit(1)
}

const FIELDS = "number,title,author,isDraft,headRefOid,commits,reviews,comments,statusCheckRollup"

const pulls = (await $`gh pr list --repo ${REVIEW_REPO} --state open --limit 50 --json ${FIELDS}`.json()) as GhPullRequest[]

const now = new Date()
const decisions = pulls.map((pull) => {
  const rollup = pull.statusCheckRollup ?? []
  const checks: CheckRun[] = rollup.map((entry) => ({
    name: entry.name ?? entry.context ?? "unnamed check",
    // A StatusContext has no `status` field. Defaulting to COMPLETED is safe
    // here because this repo's CI is GitHub Actions only — no classic status
    // integration exists that would set and hold a real PENDING state.
    status: entry.status ?? "COMPLETED",
    conclusion: entry.conclusion ?? entry.state ?? null,
    completedAt: entry.completedAt ?? null,
  }))

  const snapshot: PullRequestSnapshot = {
    number: pull.number,
    title: pull.title,
    authorLogin: pull.author?.login ?? "",
    isDraft: pull.isDraft,
    headRefOid: pull.headRefOid,
    headCommittedAt: pull.commits.at(-1)?.committedDate ?? new Date(0).toISOString(),
    reviews: pull.reviews.map((entry) => ({
      authorLogin: entry.author?.login ?? "",
      body: entry.body ?? "",
      submittedAt: entry.submittedAt,
    })),
    comments: pull.comments.map((entry) => ({
      authorLogin: entry.author?.login ?? "",
      createdAt: entry.createdAt,
    })),
    checks,
  }

  return decidePullRequest(snapshot, now)
})

console.log(JSON.stringify(decisions, null, 2))
```

- [ ] **Step 2: Register the script**

Add to the `scripts` block in `packages/script/package.json`, after `test:ci`:

```json
    "pr-review:select": "bun run src/pr-review-select-cli.ts"
```

- [ ] **Step 3: Run it against live GitHub**

Run: `bun run --cwd packages/script pr-review:select`

Expected: a JSON array with one entry per open PR, each having `number`, `title`, `action`, `reason`, `ci`. Verify by hand against known state:
- PR #25 — `action: "review"`, `reason: "no prior review"` (it has no review and completed CI with failing unit jobs).
- PR #16 — `action: "review"`. It carries a `CHANGES_REQUESTED` review from before this skill existed, so that review has no marker and is correctly ignored, giving `reason: "no prior review"`.
- No entry has `action: "skip"` yet, because no marked review exists anywhere.

If the command errors with `no default remote repository`, the `--repo` flag was dropped — that is the failure this whole design guards against.

- [ ] **Step 4: Typecheck**

Run: `bun run --cwd packages/script typecheck`

Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/script/src/pr-review-select-cli.ts packages/script/package.json
git commit -m "feat(script): add open-PR selection CLI"
```

---

### Task 3: The skill

**Files:**
- Create: `.claude/skills/review-open-prs/SKILL.md`
- Create: `.claude/skills/review-open-prs/review-rubric.md`

**Interfaces:**
- Consumes: `bun run --cwd packages/script pr-review:select` from Task 2, and its `Decision` JSON shape.
- Produces: the `/review-open-prs [--dry-run]` command. Task 4 validates it.

The rubric lives in its own file so `SKILL.md` stays a scannable procedure and the subagent gets the full rubric text without the orchestration noise.

- [ ] **Step 1: Write the rubric file**

Create `.claude/skills/review-open-prs/review-rubric.md`:

````markdown
# PR Review Rubric

You are reviewing exactly one pull request on `ecgreen/OpencodeX`. Produce one
review.

## Hard boundaries

- Every `gh` invocation carries `--repo ecgreen/OpencodeX`. A bare `gh`
  command in this checkout resolves to the upstream repo `anomalyco/opencode`
  and would act on strangers' PRs.
- Never merge, close, label, push, or modify a PR branch.
- Never modify any code or the working tree; never switch branches or create
  a worktree.
- Only `--comment` and `--request-changes` reviews. Never `--approve`.

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

Verdict is mechanical, and one of three phrases:
- **Any** Blocking finding → `Request changes`, posted with `--request-changes`.
- No Blocking findings but at least one Non-blocking or Nit → `Looks good with
  notes`, posted with `--comment`.
- No findings at all → `No findings this pass`, posted with `--comment`.

Never approve.

## Review body template

Write exactly this structure. `<SHA>` is the PR's current `headRefOid`;
`<CI>` is `present` if the rollup had any entry, otherwise `absent`.

```markdown
<!-- opencodex-pr-review sha=<SHA> ci=<CI> -->
**Verdict:** <Request changes|Looks good with notes|No findings this pass> — <N> blocking, <N> non-blocking, <N> nits

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

_Automated single-pass review. Absence of findings is not an approval; this reviewer's recall on cross-file defects is known to be well under 100%._
```

Rules for the template:
- The marker line is mandatory and must be the first line.
- The verdict phrase is exactly one of three, chosen by findings:
  `Request changes` when there is at least one Blocking finding; `Looks good
  with notes` when there are zero Blocking findings but at least one
  Non-blocking or Nit finding; `No findings this pass` when there are no
  findings at all.
- Include the "Since the last review" section **only** when you were given a
  prior review body. Every finding from that prior review must appear in it as
  exactly one of Fixed / Still open / New.
- Omit any of Blocking / Non-blocking / Nits that is empty.
- If there are no findings at all, keep the marker, the verdict line, and the
  table, then write a one-paragraph summary of what the PR does.
- Every finding cites `file:line`. No inline PR comments — this is one review
  body.
- The footer line is mandatory on every posted review body, whatever the
  verdict.

## Posting

On a normal run, write the body to a file in the session scratchpad, never
into the repo. On a dry run, write it instead to the path given in the
dispatch prompt (`.artifacts/pr-review/pr-<n>-review.md`); that directory is
git-ignored (`.gitignore:37`, pattern `**/.artifacts/`), so writing there does
not violate the never-modify-the-working-tree boundary. Then:

```
gh pr review <n> --repo ecgreen/OpencodeX --request-changes --body-file <path>
gh pr review <n> --repo ecgreen/OpencodeX --comment --body-file <path>
```

Use `--request-changes` when there is at least one Blocking finding, otherwise
`--comment`. Never `--approve`.

## What to return

Return one line of JSON and nothing else. The contract differs by mode:

- **Normal run:** post the review (see Posting), then return:

  ```json
  {"number": 25, "verdict": "request_changes", "blocking": 2, "nonBlocking": 3, "nits": 1, "posted": true}
  ```

- **Dry run:** do not post. Write the complete review body to the output path
  you were given in the dispatch prompt, then return the same shape with
  `"posted": false` and an added `"bodyPath"` field holding that path:

  ```json
  {"number": 25, "verdict": "request_changes", "blocking": 2, "nonBlocking": 3, "nits": 1, "posted": false, "bodyPath": ".artifacts/pr-review/pr-25-review.md"}
  ```

  On a dry run, the review body belongs in the file, never in your returned
  text. Returning the body as text instead of writing it to the given path is
  a failure of this contract — the orchestrator only ever sees your one-line
  JSON and the file at `bodyPath`, never anything else you print.

`"verdict"` is exactly `"request_changes"` or `"comment"` — the two ways the
review is posted (or would be posted, on a dry run). It does not carry the
three-way "No findings this pass" / "Looks good with notes" distinction from
the body text; `blocking`, `nonBlocking`, and `nits` already carry that
detail.

On a normal run, set `"posted": false` and add `"error": "<message>"` if
posting failed.
````

- [ ] **Step 2: Write the skill file**

Create `.claude/skills/review-open-prs/SKILL.md`:

````markdown
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
`title`, `action` (`review` | `skip` | `defer`), `reason`, `ci`, and for
re-reviews a `priorReview` object holding the previous review `body`.

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

<If priorReview exists, append:>
This is a re-review. Here is the review you are following up on. Resolve every
finding in it as Fixed, Still open, or New:

<priorReview.body>

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
````

- [ ] **Step 3: Verify the skill is discoverable**

Run: `ls .claude/skills/review-open-prs/`

Expected: `SKILL.md` and `review-rubric.md`. The skill registers on the next
session start; it will not appear in the current session's skill list.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/review-open-prs/
git commit -m "feat(skills): add review-open-prs PR review skill"
```

---

### Task 4: Validate end to end

The skill's real test is a dry run against live PRs, then one live post.

**Files:**
- Modify: `.claude/skills/review-open-prs/SKILL.md` or `review-rubric.md`, only if validation exposes a defect.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing. This is a verification gate.

- [ ] **Step 1: Dry-run the whole cycle**

In a fresh session, run: `/review-open-prs --dry-run`

Expected: every open PR is classified; each `review` PR's subagent writes a
complete review body to `.artifacts/pr-review/pr-<number>-review.md`, and the
orchestrator reads that file back and prints it in full above the table,
starting with a marker line whose `sha` matches that PR's `headRefOid`;
nothing is posted.

- [ ] **Step 2: Confirm nothing was posted**

Run:

```bash
gh pr list --repo ecgreen/OpencodeX --state open --limit 50 --json number,reviews \
  --jq '.[] | select(.reviews[]?.body | test("opencodex-pr-review")) | .number'
```

Expected: empty output. A dry run must leave no marker anywhere.

- [ ] **Step 3: Confirm the working tree is untouched**

Run: `git status --short`

Expected: the same entries as before the dry run. Specifically, no new
directories, no branch switch, and `packages/core/src/cross-spawn-spawner.ts`
still shows as modified rather than reverted.

- [ ] **Step 4: Judge the review quality**

Read the dry-run body for PR #25, either from the orchestrator's printed
output or directly from `.artifacts/pr-review/pr-25-review.md`. It should name
the failing `unit` jobs on Linux and Windows, attribute them, and cite
`file:line` on every finding. If the body is vague, generic, or invents
findings, fix the rubric in `.claude/skills/review-open-prs/review-rubric.md`
and repeat from Step 1.

Do not proceed to Step 5 until the dry-run output is a review you would be
willing to send someone.

- [ ] **Step 5: One live review**

Run: `/review-open-prs`

Let it post. Then confirm markers exist:

```bash
gh pr list --repo ecgreen/OpencodeX --state open --limit 50 --json number,reviews \
  --jq '.[] | select(.reviews[]?.body | test("opencodex-pr-review")) | .number'
```

Expected: the PR numbers that were reviewed.

- [ ] **Step 6: Confirm the skip path works**

Run `/review-open-prs` a second time, immediately.

Expected: every PR reviewed in Step 5 now reports `skipped / awaiting author`.
Nothing is posted twice. This is the single most important behavior in the
system — without it, an hourly loop spams every PR every hour.

- [ ] **Step 7: Commit any rubric fixes**

Only if Step 4 required changes:

```bash
git add .claude/skills/review-open-prs/
git commit -m "fix(skills): sharpen review-open-prs rubric"
```

- [ ] **Step 8: Start the loop**

```bash
/loop 1h /review-open-prs
```

---

## Notes for the implementer

- **Do not add inline PR comments.** The spec deliberately defers line-anchored
  comments; a partially-anchored review is worse than a well-referenced body.
- **Do not run the test suite against PR branches.** CI already does, on both
  Linux and Windows, and reading its results is the design.
- **The `--repo` flag is not optional anywhere.** If you find yourself writing a
  `gh` command without it, that is a bug even if it happens to work.
