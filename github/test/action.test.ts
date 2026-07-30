import { describe, expect, test } from "bun:test"

describe("OpencodeX GitHub Action", () => {
  test("installs and runs the fork release", async () => {
    const action = await Bun.file(new URL("../action.yml", import.meta.url)).text()
    expect(action).toContain("repos/ecgreen/OpencodeX/releases/latest")
    expect(action).toContain("ecgreen/OpencodeX/releases/download")
    expect(action).toContain("opencodex github run")
    expect(action).not.toContain("anomalyco/opencode")
  })

  test("uses fork-owned branch and footer conventions", async () => {
    const source = await Bun.file(
      new URL("../../packages/opencode/src/cli/cmd/github.ts", import.meta.url),
    ).text()
    expect(source).toContain("`opencodex/${type}${issueId}-${timestamp}`")
    // The footer used to lead with a share link. Sharing is gone, so all that
    // remains is the run link - but it must still be there on every comment.
    expect(source).toContain("[GitHub run](${runUrl})")
    expect(source).not.toContain("social-cards.sst.dev")
    expect(source).not.toContain("opncd.ai")
  })
})
