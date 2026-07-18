import { describe, expect, test } from "bun:test"
import path from "node:path"
import { LEGACY_WORKFLOW_FILE, renderGithubWorkflow, WORKFLOW_FILE } from "@/cli/cmd/github-workflow"

describe("OpencodeX GitHub integration", () => {
  test("renders the versioned OpencodeX action and direct token mode", () => {
    const workflow = renderGithubWorkflow("anthropic", "claude-sonnet-4-5", ["ANTHROPIC_API_KEY"])
    expect(WORKFLOW_FILE).toBe(".github/workflows/opencodex.yml")
    expect(LEGACY_WORKFLOW_FILE).toBe(".github/workflows/opencode.yml")
    expect(workflow).toContain("uses: ecgreen/OpencodeX/github@v1")
    expect(workflow).toContain("use_github_token: true")
    expect(workflow).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}")
    expect(workflow).not.toContain("anomalyco/opencode")
  })

  test("action installs an OpencodeX release and executes opencodex", async () => {
    const action = await Bun.file(path.resolve(import.meta.dirname, "../../../../github/action.yml")).text()
    expect(action).toContain("repos/ecgreen/OpencodeX/releases/latest")
    expect(action).toContain("opencodex github run")
    expect(action).not.toContain("anomalyco/opencode")
    expect(action).not.toContain("social-cards.sst.dev")
  })
})
