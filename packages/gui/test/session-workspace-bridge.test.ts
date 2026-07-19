import { describe, expect, test } from "bun:test"
import { createSessionWorkspaceBridge } from "../src/renderer/src/lib/session-workspace-bridge"

describe("session workspace bridge", () => {
  test("queues a request until its matching session workspace mounts", async () => {
    const bridge = createSessionWorkspaceBridge()
    const pending = bridge.request("ses_1", { operation: "workspace.open", input: { path: "README.md" } }, 100)
    const unregister = bridge.registerRequestHandler("ses_1", async (request) => ({
      operation: "workspace.open",
      output: { path: request.operation === "workspace.open" ? request.input.path : "" },
    }))

    expect(await pending).toEqual({ operation: "workspace.open", output: { path: "README.md" } })
    unregister()
  })

  test("does not deliver a queued request to another session", async () => {
    const bridge = createSessionWorkspaceBridge()
    const pending = bridge.request("ses_target", { operation: "browser.state", input: {} }, 10)
    const unregister = bridge.registerRequestHandler("ses_other", async () => ({ operation: "browser.state", output: { url: null } }))

    await expect(pending).rejects.toThrow("ses_target did not mount")
    unregister()
  })

  test("delivers queued and runtime open targets through the same handler", () => {
    const bridge = createSessionWorkspaceBridge()
    const targets: string[] = []
    bridge.openTarget("ses_1", { tab: "open", value: "README.md" }, 100)
    const unregister = bridge.registerTargetHandler("ses_1", (target) => targets.push(target.tab === "open" ? target.value ?? "open" : target.tab))
    bridge.openTarget("ses_1", { tab: "git" })

    expect(targets).toEqual(["README.md", "git"])
    unregister()
  })
})
