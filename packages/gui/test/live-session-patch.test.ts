import { describe, expect, test } from "bun:test"
import type {
  GlobalEvent,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot, MessageBundle, SessionCardSnapshot, SessionData } from "../src/renderer/src/lib/store"
import {
  applySessionStateSnapshot,
  applySessionStatusSnapshot,
  eventMessageID,
  eventSessionID,
  globalEventAction,
  globalEventSessionState,
  globalEventSessionStatus,
  isHighFrequencySessionEvent,
  isCapabilityRefreshEvent,
  isSessionDataEvent,
  markViewSessionsLoaded,
  mergeLiveSessionData,
  mergeSessionCardSnapshot,
  patchBoundedSessionData,
  patchSelectedSessionData,
  patchSessionData,
  patchSnapshot,
  patchVisibleViewSessionData,
  runGlobalEventAction,
  sessionDataEventTargets,
  sessionDataEventSessionIDs,
} from "../src/renderer/src/lib/live-session-patch"

describe("GUI live session patching", () => {
  test("classifies sync events and extracts session/message IDs", () => {
    const event = syncEvent("message.updated.42", { info: message("msg_classify", 1) })

    expect(isSessionDataEvent(event)).toBe(true)
    expect(eventSessionID(event)).toBe("ses_live")
    expect(eventMessageID(event)).toBe("msg_classify")
    expect(isHighFrequencySessionEvent(syncEvent("session.next.token.9", {}))).toBe(true)
  })

  test("routes global status and session state events", () => {
    expect(
      globalEventSessionStatus(event("session.status", { sessionID: "ses_status", status: { type: "idle" } })),
    ).toEqual({
      sessionID: "ses_status",
      status: { type: "idle" },
      syncVisible: true,
    })
    expect(
      globalEventSessionStatus(event("session.status", { sessionID: "ses_status", status: { type: "busy" } }))
        ?.syncVisible,
    ).toBe(true)
    expect(
      globalEventSessionStatus(event("session.status", { sessionID: "ses_status", status: { type: "retry" } }))
        ?.syncVisible,
    ).toBe(true)
    expect(globalEventSessionStatus(event("session.idle", { sessionID: "ses_idle" }))).toEqual({
      sessionID: "ses_idle",
      status: { type: "idle" },
      syncVisible: true,
    })
    expect(
      globalEventSessionState(
        event("opencodex.session_state.updated", {
          sessionID: "ses_state",
          state: { sessionID: "ses_state", reviewedFiles: [], timeUpdated: 2 },
        }),
      ),
    ).toEqual({
      sessionID: "ses_state",
      state: { sessionID: "ses_state", reviewedFiles: [], timeUpdated: 2 },
    })
    expect(
      globalEventAction(event("session.status", { sessionID: "ses_status", status: { type: "busy" } })),
    ).toMatchObject({
      type: "status",
      sessionID: "ses_status",
      syncVisible: true,
    })
    expect(
      globalEventAction(
        event("opencodex.session_state.updated", {
          sessionID: "ses_state",
          state: { sessionID: "ses_state", reviewedFiles: [], timeUpdated: 2 },
        }),
      ),
    ).toMatchObject({
      type: "state",
      sessionID: "ses_state",
    })
    expect(globalEventAction(syncEvent("session.next.token.9", {}))).toEqual({ type: "ignore" })
    expect(isCapabilityRefreshEvent(event("lsp.updated", {}))).toBe(true)
    expect(globalEventAction(event("file.watcher.updated", { file: "src/app.tsx" }))).toEqual({ type: "ignore" })
    expect(globalEventAction(event("plugin.added", {}))).toEqual({ type: "refresh", root: false })
    expect(globalEventAction(event("server.instance.disposed", {}))).toEqual({ type: "refresh", root: true })
  })

  test("runs global event actions through injected app handlers", () => {
    const calls: string[] = []
    const handlers = {
      applyStatus: (sessionID: string) => calls.push(`status:${sessionID}`),
      syncVisible: (sessionID: string) => calls.push(`sync:${sessionID}`),
      applyState: (sessionID: string) => calls.push(`state:${sessionID}`),
      applySessionData: () => calls.push("data"),
      applySnapshot: () => calls.push("snapshot"),
    }

    expect(
      runGlobalEventAction(
        { type: "status", sessionID: "ses_status", status: { type: "idle" }, syncVisible: true },
        handlers,
      ),
    ).toBeUndefined()
    expect(
      runGlobalEventAction(
        { type: "status", sessionID: "ses_busy", status: { type: "busy" }, syncVisible: true },
        handlers,
      ),
    ).toBeUndefined()
    expect(runGlobalEventAction({ type: "session-data" }, handlers)).toBeUndefined()
    expect(runGlobalEventAction({ type: "refresh", root: false }, handlers)).toEqual({ root: false })
    expect(calls).toEqual(["status:ses_status", "sync:ses_status", "status:ses_busy", "sync:ses_busy", "data"])
  })

  test("applies status events to snapshots and removes idle statuses", () => {
    const busy = applySessionStatusSnapshot(snapshot(), "ses_live", { type: "busy" } as SessionStatus)
    const idle = applySessionStatusSnapshot(busy, "ses_live", { type: "idle" } as SessionStatus)

    expect(busy?.sessionStatus.ses_live).toEqual({ type: "busy" })
    expect(busy?.sessionUiState.ses_live?.displayStatus).toBe("in_progress")
    expect(idle?.sessionStatus.ses_live).toBeUndefined()
    expect(idle?.sessionUiState.ses_live?.displayStatus).toBe("needs_review")
  })

  test("applies session state events before reconciling derived status fields", () => {
    const result = applySessionStateSnapshot(
      snapshot({
        sessionUiState: {
          ses_live: {
            ...uiState("ses_live"),
            displayStatus: "working",
            updated: true,
          },
        },
      }),
      "ses_live",
      { seenAt: 10, reviewedAt: 12, reviewedFiles: ["src/app.tsx"] },
    )

    expect(result?.sessionUiState.ses_live).toMatchObject({
      sessionID: "ses_live",
      seenAt: 10,
      reviewedAt: 12,
      reviewedFiles: ["src/app.tsx"],
      displayStatus: "idle",
      updated: false,
    })
  })

  test("applies pending part deltas when the part arrives later", () => {
    const withDelta = patchSessionData(
      sessionData([bundle("msg_delta", 1)]),
      event("message.part.delta", { messageID: "msg_delta", partID: "prt_delta", field: "text", delta: " world" }),
    )
    const result = patchSessionData(
      withDelta,
      event("message.part.updated", { part: textPart("msg_delta", "prt_delta", "hello") }),
    )

    expect(result.messages[0]?.parts[0]).toMatchObject({ id: "prt_delta", text: "hello world" })
  })

  test("treats part updates as authoritative after transient deltas", () => {
    const withDelta = patchSessionData(
      sessionData([{ ...bundle("msg_stream", 1), parts: [textPart("msg_stream", "prt_stream", "first line")] }]),
      event("message.part.delta", {
        messageID: "msg_stream",
        partID: "prt_stream",
        field: "text",
        delta: "\nsecond line",
      }),
    )
    const result = patchSessionData(
      withDelta,
      event("message.part.updated", { part: textPart("msg_stream", "prt_stream", "first line") }),
    )

    expect(result.messages[0]?.parts[0]).toMatchObject({ id: "prt_stream", text: "first line" })
  })

  test("replaces text for every authoritative part update", () => {
    const withFirstLine = patchSessionData(
      sessionData([{ ...bundle("msg_lines", 1), parts: [textPart("msg_lines", "prt_lines", "first line\n")] }]),
      event("message.part.updated", { part: textPart("msg_lines", "prt_lines", "second line\n") }),
    )
    const withRepeatedLine = patchSessionData(
      withFirstLine,
      event("message.part.updated", { part: textPart("msg_lines", "prt_lines", "second line\n") }),
    )
    const withFinalText = patchSessionData(
      withRepeatedLine,
      event("message.part.updated", {
        part: textPart("msg_lines", "prt_lines", "final rewritten text", { time: { end: 10 } }),
      }),
    )

    expect(withFirstLine.messages[0]?.parts[0]).toMatchObject({ id: "prt_lines", text: "second line\n" })
    expect(withRepeatedLine.messages[0]?.parts[0]).toMatchObject({ id: "prt_lines", text: "second line\n" })
    expect(withFinalText.messages[0]?.parts[0]).toMatchObject({ id: "prt_lines", text: "final rewritten text" })
  })

  test("treats reloaded part text as authoritative", () => {
    const current = sessionData([
      {
        ...bundle("msg_reload", 1),
        parts: [textPart("msg_reload", "prt_reload", "first line\nsecond line\nthird line")],
      },
    ])
    const staleReload = sessionData([{ ...bundle("msg_reload", 1), parts: [textPart("msg_reload", "prt_reload", "")] }])
    const finalReload = sessionData([
      {
        ...bundle("msg_reload", 1),
        parts: [textPart("msg_reload", "prt_reload", "final text", { time: { end: 10 } })],
      },
    ])

    expect(mergeLiveSessionData(current, staleReload).messages[0]?.parts[0]).toMatchObject({
      id: "prt_reload",
      text: "",
    })
    expect(mergeLiveSessionData(current, finalReload).messages[0]?.parts[0]).toMatchObject({
      id: "prt_reload",
      text: "final text",
    })
  })

  test("keeps polling reload references stable when content is unchanged", () => {
    const current = sessionData([
      { ...bundle("msg_reload", 1), parts: [textPart("msg_reload", "prt_reload", "same text", { time: { end: 10 } })] },
    ])

    expect(
      mergeLiveSessionData(
        current,
        sessionData([
          {
            ...bundle("msg_reload", 1),
            parts: [textPart("msg_reload", "prt_reload", "same text", { time: { end: 10 } })],
          },
        ]),
      ),
    ).toBe(current)
  })

  test("preserves older loaded messages while replacing covered parts", () => {
    const current = sessionData(
      [
        bundle("msg_older", 1),
        { ...bundle("msg_existing", 2), parts: [textPart("msg_existing", "prt_existing", "live text")] },
      ],
      { messageCursor: "older", messageWindowExpanded: true },
    )
    const incoming = sessionData(
      [{ ...bundle("msg_existing", 2), parts: [textPart("msg_existing", "prt_existing", "")] }, bundle("msg_new", 3)],
      { messageCursor: "tail" },
    )

    const result = mergeLiveSessionData(current, incoming)

    expect(result.messages.map((item) => item.info.id)).toEqual(["msg_older", "msg_existing", "msg_new"])
    expect(result.messages[1]?.parts[0]).toMatchObject({ text: "" })
    expect(result.messageCursor).toBe("older")
    expect(result.messageWindowExpanded).toBe(true)
  })

  test("keeps appending the live tail when older content was loaded", () => {
    const result = patchBoundedSessionData(
      sessionData([bundle("msg_existing", 1)]),
      event("message.updated", { info: message("msg_new", 2) }),
      10,
    )

    expect(result.messages.map((item) => item.info.id)).toEqual(["msg_existing", "msg_new"])
  })

  test("trims to the live tail when live updates arrive", () => {
    const result = patchBoundedSessionData(
      sessionData([bundle("msg_older", 1), bundle("msg_existing", 2)]),
      event("message.updated", { info: message("msg_new", 3) }),
      { count: 2, budget: Number.POSITIVE_INFINITY },
    )

    expect(result.messages.map((item) => item.info.id)).toEqual(["msg_existing", "msg_new"])
  })

  test("does not trim manually expanded messages when live updates arrive", () => {
    const result = patchBoundedSessionData(
      sessionData([bundle("msg_older", 1), bundle("msg_existing", 2)], {
        messageCursor: "older",
        messageWindowExpanded: true,
      }),
      event("message.updated", { info: message("msg_new", 3) }),
      { count: 2, budget: Number.POSITIVE_INFINITY },
    )

    expect(result.messages.map((item) => item.info.id)).toEqual(["msg_older", "msg_existing", "msg_new"])
    expect(result.messageWindowExpanded).toBe(true)
  })

  test("removes deleted sessions from snapshot side channels", () => {
    const result = patchSnapshot(
      snapshot({
        sessions: [session("ses_delete", 1), session("ses_keep", 2)],
        sessionStatus: { ses_delete: { type: "busy" } as SessionStatus },
        sessionUiState: {
          ses_delete: uiState("ses_delete"),
          ses_keep: uiState("ses_keep"),
        },
        permissions: [permission("ses_delete")],
        questions: [question("ses_delete")],
      }),
      event("session.deleted", { sessionID: "ses_delete" }),
    )

    expect(result.sessions.map((item) => item.id)).toEqual(["ses_keep"])
    expect(result.sessionStatus.ses_delete).toBeUndefined()
    expect(result.sessionUiState.ses_delete).toBeUndefined()
    expect(result.permissions).toEqual([])
    expect(result.questions).toEqual([])
  })

  test("keeps snapshot references stable when session card data is unchanged", () => {
    const current = snapshot()
    const result = mergeSessionCardSnapshot(current, cardSnapshot(current))

    expect(result).toBe(current)
  })

  test("routes session data events by explicit and aggregate session IDs", () => {
    expect(
      Array.from(
        sessionDataEventSessionIDs(event("message.updated", { info: message("msg_direct", 1) }), {
          currentSessionID: "ses_other",
          activeViewSessionIDs: [],
          viewSessionData: {},
        }),
      ),
    ).toEqual(["ses_live"])

    expect(
      Array.from(
        sessionDataEventSessionIDs(aggregateEvent("message.part.delta", "ses_view", { messageID: "msg_unknown" }), {
          currentSessionID: "ses_other",
          activeViewSessionIDs: ["ses_view"],
          viewSessionData: {},
        }),
      ),
    ).toEqual(["ses_view"])
  })

  test("routes session data events by loaded message IDs", () => {
    expect(
      Array.from(
        sessionDataEventSessionIDs(event("message.part.delta", { messageID: "msg_shared" }), {
          currentSessionID: "ses_current",
          activeViewSessionIDs: ["ses_view"],
          loadedSessionID: "ses_current",
          loadedSessionData: sessionData([bundle("msg_shared", 1)]),
          viewSessionData: {
            ses_view: sessionData([bundle("msg_shared", 2)]),
            ses_other: sessionData([bundle("msg_other", 3)]),
          },
        }),
      ),
    ).toEqual(["ses_current", "ses_view"])
  })

  test("selects route-aware session data patch targets", () => {
    const view = session("ses_view", 1)
    expect(
      sessionDataEventTargets(event("message.updated", { info: message("msg_direct", 1) }), {
        route: { name: "session", sessionID: "ses_live" },
        activeViewSessions: [view],
        viewSessionData: {},
      }),
    ).toEqual({ selectedSessionID: "ses_live", visibleSessionIDs: [] })

    expect(
      sessionDataEventTargets(aggregateEvent("message.part.delta", "ses_view", { messageID: "msg_unknown" }), {
        route: { name: "views" },
        activeViewSessions: [view],
        viewSessionData: {},
      }),
    ).toEqual({ visibleSessionIDs: ["ses_view"] })

    expect(
      sessionDataEventTargets(event("session.updated", {}), {
        route: { name: "views" },
        activeViewSessions: [view],
        viewSessionData: {},
      }),
    ).toBeUndefined()
  })

  test("patches selected session data from the loaded session or an empty fallback", () => {
    const current = sessionData([bundle("msg_existing", 1)])
    const result = patchSelectedSessionData({
      data: current,
      loadedSessionID: "ses_other",
      targetSessionID: "ses_live",
      event: event("message.updated", { info: message("msg_new", 2) }),
      limit: 10,
      emptyData: sessionData([]),
    })

    expect(result.messages.map((item) => item.info.id)).toEqual(["msg_new"])
  })

  test("patches only visible view sessions and marks their load time", () => {
    const other = sessionData([bundle("msg_other", 1)])
    const data = patchVisibleViewSessionData({
      data: {
        ses_live: sessionData([bundle("msg_existing", 1)]),
        ses_other: other,
      },
      sessionIDs: ["ses_live"],
      event: event("message.updated", { info: message("msg_new", 2) }),
      limit: 10,
      emptyData: sessionData([]),
    })

    expect(data.ses_live?.messages.map((item) => item.info.id)).toEqual(["msg_existing", "msg_new"])
    expect(data.ses_other?.messages.map((item) => item.info.id)).toEqual(["msg_other"])
    expect(data.ses_other).toBe(other)
    expect(markViewSessionsLoaded({ ses_other: 1 }, ["ses_live"], 10)).toEqual({ ses_other: 1, ses_live: 10 })
  })

  test("keeps view session records stable when no visible session is targeted", () => {
    const data = {
      ses_live: sessionData([bundle("msg_existing", 1)]),
      ses_other: sessionData([bundle("msg_other", 1)]),
    }

    expect(
      patchVisibleViewSessionData({
        data,
        sessionIDs: [],
        event: event("message.updated", { info: message("msg_new", 2) }),
        limit: 10,
        emptyData: sessionData([]),
      }),
    ).toBe(data)
    expect(markViewSessionsLoaded({ ses_live: 10 }, ["ses_live"], 10)).toEqual({ ses_live: 10 })
  })
})

function syncEvent(name: string, properties: Record<string, unknown>): GlobalEvent {
  return { payload: { type: "sync", name, properties } } as GlobalEvent
}

function event(type: string, properties: Record<string, unknown>): GlobalEvent {
  return { payload: { type, properties } } as GlobalEvent
}

function aggregateEvent(type: string, aggregateID: string, properties: Record<string, unknown>): GlobalEvent {
  return { payload: { type, aggregateID, properties } } as GlobalEvent
}

function sessionData(messages: MessageBundle[], input: Partial<SessionData> = {}): SessionData {
  return { messages, todos: [], diffs: [], ...input }
}

function bundle(id: string, created: number): MessageBundle {
  return { info: message(id, created), parts: [] }
}

function message(id: string, created: number): MessageBundle["info"] {
  return {
    id,
    sessionID: "ses_live",
    role: "user",
    time: { created },
  } as MessageBundle["info"]
}

function textPart(messageID: string, id: string, text: string, input: Partial<Part> = {}): Part {
  return {
    id,
    sessionID: "ses_live",
    messageID,
    type: "text",
    text,
    ...input,
  } as Part
}

function snapshot(overrides: Partial<GuiSnapshot> = {}): GuiSnapshot {
  return {
    projects: [],
    sessions: [session("ses_live", 1)],
    sessionStatus: {},
    sessionUiState: {},
    permissions: [],
    questions: [],
    providers: [],
    agents: [],
    swarms: [],
    jobs: [],
    views: [],
    ...overrides,
  }
}

function cardSnapshot(current: GuiSnapshot): SessionCardSnapshot {
  return {
    projects: [...current.projects],
    sessions: [...current.sessions],
    views: [...current.views],
    sessionStatus: { ...current.sessionStatus },
    sessionUiState: { ...current.sessionUiState },
    permissions: [...current.permissions],
    questions: [...current.questions],
    stateRevision: current.stateRevision,
  }
}

function session(id: string, updated: number): Session {
  return {
    id,
    slug: id,
    projectID: "proj_live",
    directory: "C:/Work/OpencodeX",
    title: id,
    version: "test",
    time: { created: updated, updated },
  }
}

function uiState(sessionID: string): GuiSnapshot["sessionUiState"][string] {
  return {
    sessionID,
    reviewedAt: 1,
    reviewedFiles: [],
    displayStatus: "idle",
    updated: false,
  }
}

function permission(sessionID: string): PermissionRequest {
  return {
    id: `perm_${sessionID}`,
    sessionID,
    permission: "edit",
    patterns: ["**/*.ts"],
    metadata: {},
  } as PermissionRequest
}

function question(sessionID: string): QuestionRequest {
  return {
    id: `ques_${sessionID}`,
    sessionID,
    questions: [],
    tool: "tool",
  } as QuestionRequest
}
