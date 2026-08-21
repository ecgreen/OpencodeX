export const REVIEWER_LOGIN = "ecgreen"
export const REVIEW_REPO = "ecgreen/OpencodeX"
export const NO_CI_GRACE_MS = 20 * 60 * 1000

// `pass=<N>` is optional and defaults to 1 when absent: markers posted before
// the segment existed carry no `pass=`, and reading them as pass 1 keeps them
// parsing. Making the segment required would stop those markers from parsing
// at all and put the PRs they're on into permanent re-review — the exact
// failure mode a previous fix round already closed.
const MARKER_PATTERN = /<!--\s*opencodex-pr-review\s+sha=([0-9a-f]{7,40})\s+ci=(present|absent)(?:\s+pass=(\d+))?\s*-->/

export type CiPresence = "present" | "absent"

export type Marker = {
  sha: string
  ci: CiPresence
  pass: number
}

// Only what the gate chain reads. Conclusions are not consulted here: a red
// job still gets reviewed, and the reviewer reads the conclusions itself from
// the rollup when it writes up dimension 2.
export type CheckRun = {
  name: string
  status: string
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
  nextPass: number
  priorBodies: string[]
  // GitHub refuses REQUEST_CHANGES on your own pull request, so a review of a
  // PR this account authored can only be posted with `--comment`. The reviewer
  // has to know that before it picks a command, or a blocking finding on a
  // self-authored PR fails to post, writes no marker, and is re-selected with
  // the same findings every cycle forever.
  selfAuthored: boolean
}

export function parseMarker(body: string): Marker | undefined {
  const match = MARKER_PATTERN.exec(body)
  if (!match) return undefined
  const ci = match[2]
  if (ci !== "present" && ci !== "absent") return undefined
  return { sha: match[1], ci, pass: match[3] ? Number(match[3]) : 1 }
}

// GitHub timestamps are all Z-suffixed ISO 8601 of identical width, so string
// comparison is chronological and avoids a Date allocation per comment.
export function decidePullRequest(pr: PullRequestSnapshot, now: Date): Decision {
  const base = { number: pr.number, title: pr.title, selfAuthored: pr.authorLogin === REVIEWER_LOGIN }

  const markedReviews: PriorReview[] = pr.reviews
    .flatMap((record) => {
      if (record.authorLogin !== REVIEWER_LOGIN) return []
      const marker = parseMarker(record.body)
      return marker ? [{ ...marker, body: record.body, submittedAt: record.submittedAt }] : []
    })
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0))

  // The pass count is per commit, but a new-commit review still needs every
  // review body from the latest previously reviewed commit. A later pass can
  // carry an older finding by label alone, so forwarding only that latest body
  // would discard the finding's original explanation.
  const sameShaReviews = markedReviews.filter((marked) => pr.headRefOid.startsWith(marked.sha))
  const prior = sameShaReviews.at(-1) ?? markedReviews.at(-1)
  const priorBodies = (
    sameShaReviews.length > 0
      ? sameShaReviews
      : prior
        ? markedReviews.filter((marked) => marked.sha.startsWith(prior.sha) || prior.sha.startsWith(marked.sha))
        : []
  ).map((marked) => marked.body)
  const priorPass = sameShaReviews.at(-1)?.pass ?? 0

  // Unlike the defer branches below, draft uses the skip formula (priorPass,
  // not priorPass + 1): a draft is never reviewed, so there is no upcoming
  // pass to count toward, only whatever count (if any) already exists.
  if (pr.isDraft) return { ...base, action: "skip", reason: "draft", ci: "absent", nextPass: priorPass, priorBodies }

  const pending = pr.checks.filter((check) => check.status !== "COMPLETED")
  if (pending.length > 0) {
    const names = pending.map((check) => check.name).join(", ")
    return {
      ...base,
      action: "defer",
      reason: `CI running (${names})`,
      ci: "present",
      nextPass: priorPass + 1,
      priorBodies,
    }
  }

  const ci: CiPresence = pr.checks.length > 0 ? "present" : "absent"
  if (ci === "absent" && now.getTime() - new Date(pr.headCommittedAt).getTime() < NO_CI_GRACE_MS) {
    return { ...base, action: "defer", reason: "CI not yet registered", ci, nextPass: priorPass + 1, priorBodies }
  }

  if (!prior) return { ...base, action: "review", reason: "no prior review", ci, nextPass: priorPass + 1, priorBodies }

  // `prior.sha` may be an abbreviated marker (7-40 hex chars, see
  // MARKER_PATTERN), so this is a prefix test, not exact equality: a 7-char
  // marker matching the current head means "already reviewed", not "new
  // commits". The regex's 7-char floor makes a prefix collision negligible.
  if (!pr.headRefOid.startsWith(prior.sha))
    return {
      ...base,
      action: "review",
      reason: "new commits since last review",
      ci,
      priorReview: prior,
      nextPass: priorPass + 1,
      priorBodies,
    }

  const authorReplied = pr.comments.some(
    (comment) => comment.authorLogin === pr.authorLogin && comment.createdAt > prior.submittedAt,
  )
  if (authorReplied)
    return {
      ...base,
      action: "review",
      reason: "author replied since last review",
      ci,
      priorReview: prior,
      nextPass: priorPass + 1,
      priorBodies,
    }

  if (prior.ci === "absent" && ci === "present")
    return {
      ...base,
      action: "review",
      reason: "CI arrived after last review",
      ci,
      priorReview: prior,
      nextPass: priorPass + 1,
      priorBodies,
    }

  return {
    ...base,
    action: "skip",
    reason: "awaiting author",
    ci,
    priorReview: prior,
    nextPass: priorPass,
    priorBodies,
  }
}
