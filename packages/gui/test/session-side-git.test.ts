import { describe, expect, test } from "bun:test"
import { sidePanelGitResultForKey, sidePanelStatusForPath } from "../src/renderer/src/components/session-side-git-controller"

describe("session side Git results", () => {
  test("does not expose a result loaded for another repository", () => {
    const loaded = { key: "repo-a", result: { branch: "main" } }

    expect(sidePanelGitResultForKey("repo-a", loaded)).toEqual({ branch: "main" })
    expect(sidePanelGitResultForKey("repo-b", loaded)).toBeUndefined()
  })

  test("matches a selected diff to Git status across absolute and relative paths", () => {
    const files = [{ path: "src/app.ts", code: " M", status: "modified", staged: false, unstaged: true, untracked: false }]
    expect(sidePanelStatusForPath(files, "C:/repo/src/app.ts")?.path).toBe("src/app.ts")
    expect(sidePanelStatusForPath(files, "src/other.ts")).toBeUndefined()
  })
})
