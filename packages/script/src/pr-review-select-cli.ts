#!/usr/bin/env bun
import { $ } from "bun"
import {
  decidePullRequest,
  REVIEW_REPO,
  REVIEWER_LOGIN,
  type CheckRun,
  type PullRequestSnapshot,
} from "./pr-review-select.js"

// `statusCheckRollup` mixes CheckRun nodes (name/status) with older
// StatusContext nodes (context/state), so both shapes are optional here.
type GhRollupEntry = {
  name?: string
  context?: string
  status?: string
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

// --limit 50 exceeds GitHub's 500,000-node GraphQL query-cost budget for this
// field set (the cost estimator scales with the requested limit, not the
// actual PR count), so this is capped below that threshold with margin to
// spare. Shared between the `gh` invocation and the truncation guard below
// so the two can't drift apart.
const PR_LIMIT = 30

const listed: unknown = await $`gh pr list --repo ${REVIEW_REPO} --state open --limit ${PR_LIMIT} --json ${FIELDS}`.json()
if (!Array.isArray(listed)) throw new Error("gh pr list returned an invalid response")
const pulls = listed.filter(isGhPullRequest)
if (pulls.length !== listed.length) throw new Error("gh pr list returned an invalid pull request")

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
    // A StatusContext has no `status` field. Defaulting to COMPLETED is safe
    // here because this repo's CI is GitHub Actions only — no classic status
    // integration exists that would set and hold a real PENDING state.
    status: entry.status ?? "COMPLETED",
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

function isGhPullRequest(value: unknown): value is GhPullRequest {
  if (!record(value)) return false
  if (typeof value.number !== "number" || typeof value.title !== "string") return false
  if (typeof value.isDraft !== "boolean" || typeof value.headRefOid !== "string") return false
  if (value.author !== null && (!record(value.author) || typeof value.author.login !== "string")) return false
  if (!Array.isArray(value.commits) || !value.commits.every(isCommit)) return false
  if (!Array.isArray(value.reviews) || !value.reviews.every(isReview)) return false
  if (!Array.isArray(value.comments) || !value.comments.every(isComment)) return false
  return value.statusCheckRollup === null || (Array.isArray(value.statusCheckRollup) && value.statusCheckRollup.every(isCheck))
}

function isCommit(value: unknown) {
  return record(value) && typeof value.committedDate === "string"
}

function isReview(value: unknown) {
  if (!record(value)) return false
  if (value.author !== null && (!record(value.author) || typeof value.author.login !== "string")) return false
  return (value.body === null || typeof value.body === "string") && typeof value.submittedAt === "string"
}

function isComment(value: unknown) {
  if (!record(value)) return false
  if (value.author !== null && (!record(value.author) || typeof value.author.login !== "string")) return false
  return typeof value.createdAt === "string"
}

function isCheck(value: unknown) {
  if (!record(value)) return false
  return [value.name, value.context, value.status].every((entry) => entry === undefined || typeof entry === "string")
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
