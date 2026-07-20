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

function stateSnapshot(input: {
  revision: string
  sessions: Record<string, unknown>[]
  views?: Record<string, unknown>[]
  status?: Record<string, { type: "busy" }>
  sessionUiState?: Record<string, unknown>
}) {
  return json({
    scope: { projectID: "proj_test", directory },
    epoch: "test-epoch",
    cursor: `cursor-${input.revision}`,
    digest: input.revision,
    domains: {
      catalog: { revision: input.revision, digest: input.revision },
      operations: { revision: "operations", digest: "operations" },
    },
    payloads: {
      catalog: {
        projects: [],
        sessionCards: {
          items: input.sessions,
          hasMore: false,
          missing: [],
          sessionUiState: input.sessionUiState ?? {},
        },
        views: input.views ?? [],
        sessionStatus: input.status ?? {},
        permissions: [],
        questions: [],
        sessionUiState: {},
      },
      operations: { jobs: [], swarms: [] },
    },
  })
}

describe("tui sync", () => {
  test("filters the canonical project catalog by directory until disabled", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const sessions = [
      {
        id: "ses_current",
        title: "current",
        time: { created: 0, updated: 0 },
        version: "1.15.13",
        directory,
        projectID: "proj_test",
      },
      {
        id: "ses_other",
        title: "other",
        time: { created: 0, updated: 0 },
        version: "1.15.13",
        directory: `${directory}/other`,
        projectID: "proj_test",
      },
    ]
    const { app, kv, sync } = await mount((url) => {
      if (url.pathname === "/experimental/opencodex/state") return stateSnapshot({ revision: "catalog", sessions })
      return undefined
    })

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(sync.data.session.map((session) => session.id)).toEqual(["ses_current"])

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(sync.data.session.map((session) => session.id)).toEqual(["ses_current", "ses_other"])
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
      if (url.pathname === "/experimental/opencodex/state")
        return stateSnapshot({
          revision: statusPayload[sessionID] ? "busy" : `reviewed-${reviewedAt}`,
          sessions: [sessionPayload],
          status: statusPayload,
          sessionUiState: {
            [sessionID]: {
              sessionID,
              reviewedFiles: [],
              reviewedAt,
              displayStatus: statusPayload[sessionID]
                ? "in_progress"
                : sessionPayload.time.updated > reviewedAt
                  ? "needs_review"
                  : "idle",
              updated: sessionPayload.time.updated > reviewedAt,
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

  test("server-backed review and view events refresh the authoritative catalog", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const sessionID = "ses_shared"
    const sessionPayload = {
      id: sessionID,
      title: "shared",
      time: { created: 0, updated: 100 },
      version: "1.15.13",
      directory,
      projectID: "proj_test",
    }
    let reviewedAt = 0
    let views: Record<string, unknown>[] = []
    let revision = 0
    const { app, emit, sync } = await mount((url) => {
      if (url.pathname !== "/experimental/opencodex/state") return undefined
      return stateSnapshot({
        revision: String(revision),
        sessions: [sessionPayload],
        views,
        sessionUiState: {
          [sessionID]: {
            sessionID,
            reviewedFiles: [],
            reviewedAt,
            displayStatus: sessionPayload.time.updated > reviewedAt ? "needs_review" : "idle",
            updated: sessionPayload.time.updated > reviewedAt,
          },
        },
      })
    })

    try {
      expect(deriveStatus(sessionID, sync)).toBe("needs_review")

      reviewedAt = 100
      revision += 1
      emit({
        directory: "global",
        project: "proj_test",
        payload: {
          id: "evt_shared_state",
          type: "opencodex.session_state.updated",
          properties: {
            sessionID,
            state: { sessionID, reviewedAt, reviewedFiles: [], timeUpdated: 101 },
          },
        },
      })
      await wait(() => deriveStatus(sessionID, sync) === "dormant")

      views = [
        {
          id: "view_shared",
          title: "Shared view",
          focusedSessionID: sessionID,
          layout: "auto",
          sessions: [sessionPayload],
          sessionIDs: [sessionID],
          timeCreated: 1,
          timeUpdated: 1,
        },
      ]
      revision += 1
      emit({
        directory: "global",
        project: "proj_test",
        payload: {
          id: "evt_shared_view",
          type: "opencodex.view.created",
          properties: { viewID: "view_shared" },
        },
      })
      await wait(() => sync.data.opencodex_view.some((view) => view.id === "view_shared"))
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
