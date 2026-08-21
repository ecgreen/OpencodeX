import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { decidePullRequest, parseMarker, NO_CI_GRACE_MS, type PullRequestSnapshot } from "../src/pr-review-select.js"

// Nothing in `src` renders a marker: the one that reaches GitHub is written by
// the review subagent from the template in review-rubric.md. This local
// stand-in builds fixtures for the gate-chain tests; the template itself is
// held to `parseMarker` by "the rubric's own marker template parses" below,
// which is what actually catches the two drifting apart.
function formatMarker(sha: string, ci: "present" | "absent", pass: number): string {
  return `<!-- opencodex-pr-review sha=${sha} ci=${ci} pass=${pass} -->`
}

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
    checks: [{ name: "unit (linux)", status: "COMPLETED" }],
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

  // Reviews posted before the pass segment existed must remain readable so
  // they continue to gate the same head and can be carried into a re-review.
  test("parses a marker without a pass segment as pass 1", () => {
    expect(parseMarker(`<!-- opencodex-pr-review sha=${SHA} ci=present -->\nbody`)).toEqual({
      sha: SHA,
      ci: "present",
      pass: 1,
    })
  })

  // The marker that actually reaches GitHub is rendered by the review subagent
  // from the template in review-rubric.md, so that template - not any helper in
  // `src` - is what has to satisfy MARKER_PATTERN. Drift between the two makes
  // every posted review unparseable and puts every PR into permanent
  // re-review, silently, which is exactly what this asserts against.
  test("the rubric's own marker template parses", () => {
    const rubricPath = path.join(import.meta.dir, "../../../.claude/skills/review-open-prs/review-rubric.md")
    const template = /<!-- opencodex-pr-review.*?-->/.exec(readFileSync(rubricPath, "utf8"))?.[0]
    expect(template).toBeDefined()
    const rendered = template!.replace("<SHA>", SHA).replace("<CI>", "present").replace("<PASS>", "2")
    expect(parseMarker(rendered)).toEqual({ sha: SHA, ci: "present", pass: 2 })
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
      { name: "unit (linux)", status: "COMPLETED" },
      { name: "gui e2e (chromium)", status: "IN_PROGRESS" },
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

  // Conclusions are not part of the gate: a red run is reviewed exactly like a
  // green one, and it is the reviewer that reads conclusions off the rollup.
  // Only "did every check finish" decides review-versus-defer.
  test("reviews a PR once every check has completed, whatever it concluded", () => {
    const decision = decidePullRequest(snapshot({ checks: [{ name: "unit (linux)", status: "COMPLETED" }] }), NOW)
    expect(decision.action).toBe("review")
  })

  // One review per head SHA. A reviewed commit that nobody has touched since
  // has nothing new to say about it, so it goes quiet until something actually
  // changes: new commits, an author reply, or CI arriving.
  test("skips a reviewed head that nothing has happened to since", () => {
    const reviews = [review(formatMarker(SHA, "present", 1), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("awaiting author")
    expect(decision.priorReview?.pass).toBe(1)
    // For a skip, nextPass is simply the count already reached, not a further increment.
    expect(decision.nextPass).toBe(1)
  })

  test("re-reviews when the head sha moved", () => {
    const reviews = [review(formatMarker(OTHER_SHA, "present", 2), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("new commits since last review")
    // A new head SHA carries no prior marker of its own, however many passes
    // the previous SHA reached: the pass count restarts per commit.
    expect(decision.nextPass).toBe(1)
    expect(decision.priorBodies).toEqual([reviews[0].body])
  })

  // GitHub refuses REQUEST_CHANGES on your own PR, so the reviewer needs this
  // flag to pick `--comment` up front. Without it a blocking finding on a
  // self-authored PR fails to post, writes no marker, and comes back with the
  // same findings every cycle forever.
  test("flags a PR authored by the reviewer", () => {
    expect(decidePullRequest(snapshot({ authorLogin: "ecgreen" }), NOW).selfAuthored).toBe(true)
    expect(decidePullRequest(snapshot(), NOW).selfAuthored).toBe(false)
  })

  // A force-push back onto an already-reviewed commit leaves a newer review
  // sitting at the abandoned SHA. The review at the current head must win.
  test("prefers a review at the current head over a newer one at an abandoned sha", () => {
    const reviews = [
      review(formatMarker(SHA, "present", 1), "2026-08-19T10:00:00Z"),
      review(formatMarker(OTHER_SHA, "present", 1), "2026-08-19T11:00:00Z"),
    ]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.reason).toBe("awaiting author")
    expect(decision.priorReview?.sha).toBe(SHA)
    expect(decision.priorBodies).toEqual([reviews[0].body])
  })

  test("carries every body from the latest previously reviewed head into a new-commit review", () => {
    const abandonedSha = "2222222222222222222222222222222222222222"
    const reviews = [
      review(formatMarker(abandonedSha, "present", 1), "2026-08-19T09:00:00Z"),
      review(formatMarker(OTHER_SHA, "present", 2), "2026-08-19T11:30:00Z"),
      review(formatMarker(OTHER_SHA.slice(0, 7), "present", 1), "2026-08-19T11:00:00Z"),
    ]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.reason).toBe("new commits since last review")
    expect(decision.priorBodies).toEqual([reviews[2].body, reviews[1].body])
    expect(decision.nextPass).toBe(1)
  })

  test("skips when an abbreviated marker prefix-matches the current head", () => {
    const reviews = [review(formatMarker(SHA.slice(0, 7), "present", 1), "2026-08-19T11:00:00Z")]
    const decision = decidePullRequest(snapshot({ reviews }), NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toBe("awaiting author")
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

  // Author replies and newly arrived CI keep triggering at the same head.
  // nextPass can exceed 2 and the dispatch must retain every prior body.
  test("re-reviews via author reply after several reviews here, carrying every prior body", () => {
    const reviews = [
      review(formatMarker(SHA, "present", 1), "2026-08-19T11:00:00Z"),
      review(formatMarker(SHA, "present", 2), "2026-08-19T11:30:00Z"),
    ]
    const comments = [{ authorLogin: "omgoshjosh", createdAt: "2026-08-19T11:45:00Z" }]
    const decision = decidePullRequest(snapshot({ reviews, comments }), NOW)
    expect(decision.action).toBe("review")
    expect(decision.reason).toBe("author replied since last review")
    expect(decision.priorBodies.length).toBe(2)
    expect(decision.priorBodies).toEqual([reviews[0].body, reviews[1].body])
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
