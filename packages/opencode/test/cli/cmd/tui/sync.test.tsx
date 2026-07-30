/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"
import type { AssistantMessage, GlobalEvent, TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import { deriveStatus } from "../../../../src/cli/cmd/tui/component/opencodex-session-status"
import {
  TUI_SESSION_PAGE_LIMIT,
  TUI_SESSION_TAIL_LIMIT,
} from "../../../../src/cli/cmd/tui/context/sync-transcript"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory,
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
  projects?: Record<string, unknown>[]
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
        projects: input.projects ?? [],
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

function sessionSnapshot(
  session: Record<string, unknown>,
  messages: { id: string; created: number; text: string }[],
  boundary: { hasMore: boolean; next?: string },
) {
  return json({
    scope: { projectID: "proj_test", directory },
    epoch: "test-epoch",
    cursor: "test-cursor",
    digest: messages.map((message) => message.id).join(":"),
    session,
    messages: {
      items: messages.map((message) => ({
        info: {
          id: message.id,
          sessionID: session.id,
          role: "user",
          time: { created: message.created },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: [
          {
            id: `part-${message.id}`,
            sessionID: session.id,
            messageID: message.id,
            type: "text",
            text: message.text,
          },
        ],
      })),
      coverage: {
        firstMessageID: messages[0]?.id,
        lastMessageID: messages.at(-1)?.id,
      },
      boundary,
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  })
}

describe("tui sync", () => {
  test("loads only the tail and pages older history on demand", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const sessionID = "ses_history"
    const session = {
      id: sessionID,
      title: "history",
      time: { created: 0, updated: 4 },
      version: "1.15.13",
      directory,
      projectID: "proj_test",
    }
    const requests = new Array<URL>()
    const { app, sync } = await mount((url) => {
      if (url.pathname === "/experimental/opencodex/state")
        return stateSnapshot({ revision: "history", sessions: [session] })
      if (url.pathname !== `/experimental/opencodex/state/session/${sessionID}`) return undefined
      requests.push(url)
      if (url.searchParams.get("before") === "before-3") {
        return sessionSnapshot(
          session,
          [
            { id: "message-1", created: 1, text: "first" },
            { id: "message-2", created: 2, text: "second" },
          ],
          { hasMore: false },
        )
      }
      return sessionSnapshot(
        session,
        [
          { id: "message-3", created: 3, text: "third" },
          { id: "message-4", created: 4, text: "fourth" },
        ],
        { hasMore: true, next: "before-3" },
      )
    })

    try {
      await sync.session.sync(sessionID)

      expect(sync.data.message[sessionID]?.map((message) => message.id)).toEqual(["message-3", "message-4"])
      expect(requests.map((url) => url.searchParams.get("limit"))).toEqual([String(TUI_SESSION_TAIL_LIMIT)])
      expect(requests.map((url) => url.searchParams.get("before"))).toEqual([null])
      expect(sync.session.transcript(sessionID)).toMatchObject({
        hasOlder: true,
        olderCursor: "before-3",
        loadingOlder: false,
        expanded: false,
      })

      expect(await sync.session.loadOlder(sessionID)).toBe(true)

      expect(sync.data.message[sessionID]?.map((message) => message.id)).toEqual([
        "message-1",
        "message-2",
        "message-3",
        "message-4",
      ])
      expect(requests.map((url) => url.searchParams.get("limit"))).toEqual([
        String(TUI_SESSION_TAIL_LIMIT),
        String(TUI_SESSION_PAGE_LIMIT),
      ])
      expect(requests.map((url) => url.searchParams.get("before"))).toEqual([null, "before-3"])
      expect(sync.session.transcript(sessionID)).toMatchObject({
        hasOlder: false,
        loadingOlder: false,
        expanded: true,
      })
      // Nothing left to page: a second request must not be issued.
      expect(await sync.session.loadOlder(sessionID)).toBe(false)
      expect(requests.length).toBe(2)
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("projects streaming text deltas before the assistant message completes", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const sessionID = "ses_stream"
    const session = {
      id: sessionID,
      title: "stream",
      time: { created: 0, updated: 1 },
      version: "1.15.13",
      directory,
      projectID: "proj_test",
    }
    let rootRevision = "stream"
    let rootStatus: Record<string, { type: "busy" }> = {}
    const { app, emit, sync } = await mount((url) => {
      if (url.pathname === "/experimental/opencodex/state")
        return stateSnapshot({
          revision: rootRevision,
          sessions: [session],
          status: rootStatus,
          sessionUiState: {
            [sessionID]: {
              sessionID,
              reviewedFiles: [],
              displayStatus: "needs_review",
              updated: true,
            },
          },
        })
      if (url.pathname === `/experimental/opencodex/state/session/${sessionID}`)
        return sessionSnapshot(session, [{ id: "message-user", created: 1, text: "hello" }], { hasMore: false })
      return undefined
    })

    try {
      await sync.session.sync(sessionID)
      const submitted: UserMessage = {
        id: "message-submitted",
        sessionID,
        role: "user",
        time: { created: 2 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      }
      sync.session.setPendingPrompt(sessionID, submitted.id)
      expect(deriveStatus(sessionID, sync)).toBe("in_progress")
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt-submitted",
          type: "message.updated",
          properties: { sessionID, info: submitted },
        },
      })
      await wait(() => sync.data.message[sessionID]?.at(-1)?.id === submitted.id)
      expect(sync.data.session_pending_prompt[sessionID]).toBe(submitted.id)
      expect(deriveStatus(sessionID, sync)).toBe("in_progress")
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt-idle-handoff",
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        },
      })
      await Bun.sleep(100)
      expect(sync.data.session_pending_prompt[sessionID]).toBe(submitted.id)
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt-busy-handoff",
          type: "session.status",
          properties: { sessionID, status: { type: "busy" } },
        },
      })
      await wait(() => sync.data.session_status[sessionID]?.type === "busy")
      expect(sync.data.session_pending_prompt[sessionID]).toBe(submitted.id)
      const message: AssistantMessage = {
        id: "message-assistant",
        sessionID,
        role: "assistant",
        time: { created: 2 },
        parentID: submitted.id,
        modelID: "test",
        providerID: "test",
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      const part: TextPart = {
        id: "part-assistant",
        sessionID,
        messageID: message.id,
        type: "text",
        text: "",
      }
      emit({
        directory,
        project: "proj_test",
        payload: { id: "evt-message", type: "message.updated", properties: { sessionID, info: message } },
      })
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt-part",
          type: "message.part.updated",
          properties: { sessionID, part, time: Date.now() },
        },
      })
      await wait(() => sync.data.part[message.id]?.[0]?.id === part.id)
      expect(sync.data.session_pending_prompt[sessionID]).toBeUndefined()
      const historicalPart = sync.data.part["message-user"]?.[0]
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt-delta-1",
          type: "message.part.delta",
          properties: { sessionID, messageID: message.id, partID: part.id, field: "text", delta: "live " },
        },
      })
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt-delta-2",
          type: "message.part.delta",
          properties: { sessionID, messageID: message.id, partID: part.id, field: "text", delta: "text" },
        },
      })

      await wait(() => {
        const live = sync.data.part[message.id]?.[0]
        return live?.type === "text" && live.text === "live text"
      })

      expect(sync.data.message[sessionID]?.at(-1)?.id).toBe(message.id)
      expect(sync.data.part["message-user"]?.[0]).toBe(historicalPart)
      const liveMessage = sync.data.message[sessionID]?.at(-1)
      expect(liveMessage?.role).toBe("assistant")
      expect(liveMessage?.role === "assistant" ? liveMessage.time.completed : undefined).toBeUndefined()

      sync.session.setPendingPrompt(sessionID, "message-cancelled")
      rootRevision = "stream-cancelled"
      rootStatus = {}
      await sync.session.refreshStatus()
      await wait(() => sync.data.session_pending_prompt[sessionID] === undefined)
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("shows the canonical cross-project catalog until directory filtering is enabled", async () => {
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
    const projects = [
      {
        id: "proj_test",
        project: { id: "proj_test", worktree: directory, time: { created: 0, updated: 0 }, sandboxes: [] },
        folders: [],
        sessionIDs: ["ses_current", "ses_other"],
      },
    ]
    const views = [
      {
        id: "view_test",
        title: "View",
        layout: "list",
        sessionIDs: ["ses_current", "ses_other"],
        focusedSessionID: "ses_other",
        timeCreated: 0,
        timeUpdated: 0,
      },
    ]
    const { app, emit, kv, sync } = await mount((url) => {
      if (url.pathname === "/experimental/opencodex/state")
        return stateSnapshot({ revision: "catalog", sessions, projects, views })
      if (url.pathname === "/experimental/opencodex/state/session/ses_other")
        return sessionSnapshot(sessions[1], [{ id: "message-other", created: 1, text: "other" }], {
          hasMore: false,
        })
      return undefined
    })

    try {
      expect(kv.get("session_directory_filter_enabled", false)).toBe(false)
      expect(sync.data.session.map((session) => session.id)).toEqual(["ses_current", "ses_other"])
      expect(sync.data.opencodex_project[0]?.sessionIDs).toEqual(["ses_current", "ses_other"])
      expect(sync.data.opencodex_project[0]?.sessions.map((session) => session.id)).toEqual([
        "ses_current",
        "ses_other",
      ])
      expect(sync.data.opencodex_view[0]?.sessionIDs).toEqual(["ses_current", "ses_other"])
      expect(sync.data.opencodex_view[0]?.sessions.map((session) => session.id)).toEqual(["ses_current", "ses_other"])
      expect(sync.data.opencodex_view[0]?.focusedSessionID).toBe("ses_other")
      await sync.session.sync("ses_other")
      expect(sync.data.message.ses_other?.[0]?.id).toBe("message-other")

      kv.set("session_directory_filter_enabled", true)
      await sync.session.refresh()

      expect(sync.data.session.map((session) => session.id)).toEqual(["ses_current"])
      emit({
        directory: `${directory}/other`,
        project: "proj_test",
        payload: {
          id: "evt-hidden-delta",
          type: "message.part.delta",
          properties: {
            sessionID: "ses_other",
            messageID: "message-other",
            partID: "part-message-other",
            field: "text",
            delta: " hidden",
          },
        },
      })
      await Bun.sleep(30)
      expect(sync.session.get("ses_other")).toBeUndefined()
      expect(sync.data.message.ses_other).toBeUndefined()
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
