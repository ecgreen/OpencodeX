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
