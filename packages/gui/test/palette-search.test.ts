import { describe, expect, test } from "bun:test"
import { bestFuzzyScore, fuzzyScore, rankByScore } from "../src/renderer/src/lib/palette-search"

describe("palette fuzzy search", () => {
  test("returns undefined when the query does not match", () => {
    expect(fuzzyScore("xyz", "switch session")).toBeUndefined()
    expect(fuzzyScore("sss", "")).toBeUndefined()
  })

  test("matches case-insensitively and trims the query", () => {
    expect(fuzzyScore("  SWITCH ", "Switch Session")).toBeDefined()
  })

  test("ranks exact substrings above subsequence matches", () => {
    const substring = fuzzyScore("sess", "Switch session")!
    const subsequence = fuzzyScore("swsn", "Switch session")!
    expect(substring).toBeGreaterThan(subsequence)
  })

  test("ranks earlier substring matches above later ones", () => {
    const early = fuzzyScore("sess", "session switch")!
    const late = fuzzyScore("sess", "switch to the session")!
    expect(early).toBeGreaterThan(late)
  })

  test("rewards consecutive and word-start subsequence matches", () => {
    const consecutive = fuzzyScore("swi", "switch session")!
    const scattered = fuzzyScore("swh", "switch session")!
    expect(consecutive).toBeGreaterThan(scattered)
  })

  test("bestFuzzyScore picks the strongest field", () => {
    const score = bestFuzzyScore("dashboard", ["switch session", "open operations dashboard"])
    expect(score).toBe(fuzzyScore("dashboard", "open operations dashboard"))
  })

  test("rankByScore orders matches and drops non-matches", () => {
    const ranked = rankByScore("session", [
      { title: "Switch session" },
      { title: "Create swarm" },
      { title: "Fix parser" },
    ], (item) => [item.title])
    expect(ranked.map((item) => item.title)).toEqual(["Switch session"])
  })

  test("rankByScore puts tighter titles first", () => {
    const ranked = rankByScore("view", [
      { title: "Open view editor preferences" },
      { title: "Open view" },
    ], (item) => [item.title])
    expect(ranked[0]?.title).toBe("Open view")
  })
})
