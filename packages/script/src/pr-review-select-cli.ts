#!/usr/bin/env bun
import { $ } from "bun"
import { decidePullRequest, REVIEW_REPO, type CheckRun, type PullRequestSnapshot } from "./pr-review-select.js"

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

const FIELDS = "number,title,author,isDraft,headRefOid,commits,reviews,comments,statusCheckRollup"

// --limit 50 exceeds GitHub's 500,000-node GraphQL query-cost budget for this
// field set (the cost estimator scales with the requested limit, not the
// actual PR count), so this is capped below that threshold with margin to
// spare. Shared between the `gh` invocation and the truncation guard below
// so the two can't drift apart.
const PR_LIMIT = 30

const pulls = (await $`gh pr list --repo ${REVIEW_REPO} --state open --limit ${PR_LIMIT} --json ${FIELDS}`.json()) as GhPullRequest[]

if (pulls.length >= PR_LIMIT) {
  console.error(
    `warning: gh pr list returned ${pulls.length} open PRs, at or above the --limit ${PR_LIMIT} cap. ` +
      "Older open PRs may have been silently dropped from this run. " +
      "Raise PR_LIMIT in pr-review-select-cli.ts or reduce the requested field set to fit them back in.",
  )
}

const now = new Date()
const decisions = pulls.map((pull) => {
  const rollup = pull.statusCheckRollup ?? []
  const checks: CheckRun[] = rollup.map((entry) => ({
    name: entry.name ?? entry.context ?? "unnamed check",
    // A StatusContext has no `status` field and is always already resolved.
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
