/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { deriveStatus } from "../../../../src/cli/cmd/tui/component/opencodex-session-status"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount()

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/opencode")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("refresh updates session status for lightweight polling", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const sessionID = "ses_poll"
    const sessionPayload = {
      id: sessionID,
      title: "polling",
      time: { created: 0, updated: 100 },
      version: "1.15.13",
      directory,
      projectID: "proj_test",
    }
    let statusPayload: Record<string, { type: "busy" }> = {}
    let reviewedAt = sessionPayload.time.updated
    const { app, sync } = await mount((url) => {
      if (url.pathname === "/experimental/opencodex/session-sync")
        return json({
          changed: true,
          revision: statusPayload[sessionID] ? "busy" : `reviewed-${reviewedAt}`,
          snapshot: {
            projects: [],
            sessions: [sessionPayload],
            views: [],
            sessionStatus: statusPayload,
            permissions: [],
            questions: [],
            sessionUiState: {
              [sessionID]: {
                sessionID,
                reviewedFiles: [],
                reviewedAt,
                displayStatus: statusPayload[sessionID] ? "in_progress" : sessionPayload.time.updated > reviewedAt ? "needs_review" : "idle",
                updated: sessionPayload.time.updated > reviewedAt,
              },
            },
          },
        })
      return undefined
    })

    try {
      expect(deriveStatus(sessionID, sync)).toBe("dormant")

      statusPayload = { [sessionID]: { type: "busy" } }
      await sync.session.refreshStatus()

      expect(deriveStatus(sessionID, sync)).toBe("in_progress")

      statusPayload = {}
      reviewedAt = 0
      await sync.session.refreshStatus()

      expect(deriveStatus(sessionID, sync)).toBe("needs_review")
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount()

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })
})
