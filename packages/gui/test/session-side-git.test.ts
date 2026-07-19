import { describe, expect, test } from "bun:test"
import { sidePanelGitResultForKey } from "../src/renderer/src/components/session-side-git-controller"

describe("session side Git results", () => {
  test("does not expose a result loaded for another repository", () => {
    const loaded = { key: "repo-a", result: { branch: "main" } }

    expect(sidePanelGitResultForKey("repo-a", loaded)).toEqual({ branch: "main" })
    expect(sidePanelGitResultForKey("repo-b", loaded)).toBeUndefined()
  })
})
