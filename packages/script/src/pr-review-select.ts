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

  if (prior.sha !== pr.headRefOid)
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
