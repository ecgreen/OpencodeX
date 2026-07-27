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
    expect(source).toContain("[OpencodeX session]")
    expect(source).not.toContain("social-cards.sst.dev")
  })
})
