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
  test("reads sha, ci presence, and pass", () => {
    expect(parseMarker(`<!-- opencodex-pr-review sha=${SHA} ci=present pass=2 -->\nbody`)).toEqual({
      sha: SHA,
      ci: "present",
      pass: 2,
    })
  })

  test("returns undefined without a marker", () => {
    expect(parseMarker("Looks good to me")).toBeUndefined()
  })

  test("returns undefined for a malformed marker", () => {
    expect(parseMarker("<!-- opencodex-pr-review sha=zzz ci=maybe -->")).toBeUndefined()
  })

  // Seven reviews are already posted on live PRs with no `pass=` segment.
  // Treating them as pass 1 is what lets them naturally receive their second
  // pass on the next cycle instead of failing to parse forever.
  test("parses a marker without a pass segment as pass 1", () => {
    expect(parseMarker(`<!-- opencodex-pr-review sha=${SHA} ci=present -->\nbody`)).toEqual({
      sha: SHA,
      ci: "present",
      pass: 1,
    })
  })

  test("round-trips with formatMarker", () => {
    expect(parseMarker(formatMarker(SHA, "absent", 2))).toEqual({ sha: SHA, ci: "absent", pass: 2 })
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
    const decision = decidePullRequest(snapshot(), NOW)
    expect(decision.action).toBe("review")
    // No prior marked review anywhere: the review about to be posted is pass 1.
    expect(decision.nextPass).toBe(1)
    expect(decision.priorBodies).toEqual([])
  })

  test("reviews a PR whose completed CI concluded in failure", () => {
    const checks = [
      { name: "unit (linux)", status: "COMPLETED", conclusion: "FAILURE", completedAt: "2026-08-19T10:05:00Z" },
    ]
    const decision = decidePullRequest(snapshot({ checks }), NOW)
    expect(decision.action).toBe("review")
  })

  test("returns 'second pass' when the prior marker's pass is 1", () => {
    const reviews = [review(formatMarker(SHA, "present", 1), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("second pass")
    expect(decision.priorReview?.pass).toBe(1)
    // The review about to be written records the next pass number, and reads
    // the first pass's body to do an independent second look.
    expect(decision.nextPass).toBe(2)
    expect(decision.priorBodies).toEqual([reviews[0]!.body])
  })

  test("skips when the prior marker has already reached pass 2", () => {
    const reviews = [review(formatMarker(SHA, "present", 2), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("awaiting author")
    expect(decision.priorReview?.sha).toBe(SHA)
    // For a skip, nextPass is simply the count already reached, not a further increment.
    expect(decision.nextPass).toBe(2)
  })

  test("re-reviews when the head sha moved", () => {
    const reviews = [review(formatMarker(OTHER_SHA, "present", 2), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("new commits since last review")
    // A new head SHA carries no prior marker of its own, however many passes
    // the previous SHA reached: the two-pass count restarts per commit.
    expect(decision.nextPass).toBe(1)
    expect(decision.priorBodies).toEqual([])
  })

  test("skips when an abbreviated marker prefix-matches the current head", () => {
    const reviews = [review(formatMarker(SHA.slice(0, 7), "present", 2), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("awaiting author")
  })

  test("an abbreviated pass=1 marker still prefix-matches and returns second pass", () => {
    const reviews = [review(formatMarker(SHA.slice(0, 7), "present", 1), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("second pass")
  })

  test("re-reviews after a rebase that backdates the head commit", () => {
    const reviews = [review(formatMarker(OTHER_SHA, "present", 1), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews, headCommittedAt: "2026-08-01T00:00:00Z" }), NOW)
    expect(decision.action).toBe("review")
  })

  test("re-reviews when the PR author replied after the review", () => {
    const reviews = [review(formatMarker(SHA, "present", 1), "2026-08-19T11:00:00Z")]
    const comments = [{ authorLogin: "omgoshjosh", createdAt: "2026-08-19T11:30:00Z" }]
    const decision = decidePullRequest(snapshot({ reviews, comments }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("author replied since last review")
  })

  // The author-replied and CI-arrived gates fire even once both passes are
  // already posted at this head SHA (that responsiveness is intentional,
  // not gated behind the pass cap). This is the case the fix-round-1 review
  // flagged: nextPass can exceed 2 and priorBodies can hold more than one
  // entry here, which the dispatch template must handle without hardcoding
  // "at most 2" or dropping anything but the first entry.
  test("re-reviews via author reply even after both passes are posted, carrying every prior body", () => {
    const reviews = [
      review(formatMarker(SHA, "present", 1), "2026-08-19T11:00:00Z"),
      review(formatMarker(SHA, "present", 2), "2026-08-19T11:30:00Z"),
    ]
    const comments = [{ authorLogin: "omgoshjosh", createdAt: "2026-08-19T11:45:00Z" }]
    const decision = decidePullRequest(snapshot({ reviews, comments }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("author replied since last review")
    expect(decision.priorBodies.length).toBe(2)
    expect(decision.priorBodies).toEqual([reviews[0]!.body, reviews[1]!.body])
    expect(decision.nextPass).toBe(3)
  })

  test("orders priorBodies oldest first even when reviews arrive out of order", () => {
    const older = review(formatMarker(SHA, "absent", 1), "2026-08-19T11:00:00Z")
    const newer = review(formatMarker(SHA, "absent", 2), "2026-08-19T11:30:00Z")
    const reviews = [newer, older] // deliberately out of chronological order
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("CI arrived after last review")
    expect(decision.priorBodies).toEqual([older.body, newer.body])
  })

  test("ignores comments from anyone but the PR author", () => {
    const reviews = [review(formatMarker(SHA, "present", 2), "2026-08-19T11:00:00Z")]
    const comments = [{ authorLogin: "ecgreen", createdAt: "2026-08-19T11:30:00Z" }]
    expect(decidePullRequest(snapshot({ reviews, comments }), NOW).action).toBe("skip")
  })

  test("re-reviews when CI arrived after a ci=absent review", () => {
    const reviews = [review(formatMarker(SHA, "absent", 1), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("CI arrived after last review")
  })

  test("still skips a ci=absent review while CI is still missing", () => {
    const reviews = [review(formatMarker(SHA, "absent", 2), "2026-08-19T11:00:00Z")]
    const headCommittedAt = new Date(NOW.getTime() - NO_CI_GRACE_MS - 60_000).toISOString()
    expect(decidePullRequest(snapshot({ reviews, checks: [], headCommittedAt }), NOW).action).toBe("skip")
  })

  test("ignores marked reviews from other accounts", () => {
    const reviews = [review(formatMarker(SHA, "present", 1), "2026-08-19T11:00:00Z", "someone-else")]
    expect(decidePullRequest(snapshot({ reviews }), NOW).action).toBe("review")
  })

  test("ignores unmarked human reviews", () => {
    const reviews = [review("Looks good, ship it", "2026-08-19T11:00:00Z")]
    expect(decidePullRequest(snapshot({ reviews }), NOW).action).toBe("review")
  })

  test("uses the most recent marked review when several exist", () => {
    const reviews = [
      review(formatMarker(OTHER_SHA, "present", 2), "2026-08-18T09:00:00Z"),
      review(formatMarker(SHA, "present", 2), "2026-08-19T11:00:00Z"),
    ]
    expect(decidePullRequest(snapshot({ reviews }), NOW).action).toBe("skip")
  })
})
