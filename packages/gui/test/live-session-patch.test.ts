import { describe, expect, test } from "bun:test"
import type { GlobalEvent, Part, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot, MessageBundle, SessionCardSnapshot, SessionData } from "../src/renderer/src/lib/store"
import {
  eventMessageID,
  eventSessionID,
  globalEventSessionState,
  globalEventSessionStatus,
} from "../src/renderer/src/lib/live-session-event"
import {
  globalEventAction,
  isHighFrequencySessionEvent,
  isCapabilityRefreshEvent,
  isSessionDataEvent,
  mergeLiveSessionData,
  mergeSessionCardSnapshot,
} from "../src/renderer/src/lib/live-session-patch"

describe("GUI live session projection", () => {
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
    expect(globalEventAction(event("message.updated", { info: message("msg_data", 1) }))).toEqual({
      type: "session-data",
    })
    expect(globalEventAction(event("session.deleted", { sessionID: "ses_gone" }))).toEqual({ type: "snapshot" })
    expect(globalEventAction(syncEvent("session.next.token.9", {}))).toEqual({ type: "ignore" })
    expect(isCapabilityRefreshEvent(event("lsp.updated", {}))).toBe(true)
    expect(globalEventAction(event("file.watcher.updated", { file: "src/app.tsx" }))).toEqual({ type: "ignore" })
    expect(globalEventAction(event("plugin.added", {}))).toEqual({ type: "refresh", root: false })
    expect(globalEventAction(event("server.instance.disposed", {}))).toEqual({ type: "refresh", root: true })
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
    const parts = [textPart("msg_reload", "prt_reload", "same text", { time: { end: 10 } })]
    const todos = [] as SessionData["todos"]
    const diffs = [] as SessionData["diffs"]
    const current = sessionData([{ ...bundle("msg_reload", 1), parts }], { todos, diffs })

    expect(
      mergeLiveSessionData(current, sessionData([{ ...bundle("msg_reload", 1), parts }], { todos, diffs })),
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

  test("merges expanded transcripts in creation order without re-sorting", () => {
    const current = sessionData([bundle("msg_1", 1), bundle("msg_3", 3), bundle("msg_5", 5)], {
      messageWindowExpanded: true,
    })
    const incoming = sessionData([bundle("msg_2", 2), bundle("msg_4", 4), bundle("msg_6", 6)])

    expect(mergeLiveSessionData(current, incoming).messages.map((item) => item.info.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
      "msg_4",
      "msg_5",
      "msg_6",
    ])
  })

  test("keeps snapshot references stable when session card data is unchanged", () => {
    const current = snapshot()
    const result = mergeSessionCardSnapshot(current, cardSnapshot(current))

    expect(result).toBe(current)
  })

  test("keeps project and view references stable when only their arrays are rebuilt", () => {
    const live = session("ses_live", 1)
    const current = snapshot({
      sessions: [live],
      projects: [{ id: "proj_live", sessionIDs: ["ses_live"], sessions: [live], terminalSessions: [] }],
      views: [{ id: "view_live", sessionIDs: ["ses_live"], sessions: [live], terminalSessions: [] }],
    } as unknown as Partial<GuiSnapshot>)
    // The selector re-spreads each project and view with freshly built arrays;
    // only the element references survive.
    const rebuilt: SessionCardSnapshot = {
      ...cardSnapshot(current),
      projects: current.projects.map((project) => ({ ...project, sessions: [...project.sessions] })),
      views: current.views.map((view) => ({ ...view, sessions: [...view.sessions] })),
    }

    expect(mergeSessionCardSnapshot(current, rebuilt)).toBe(current)
  })

  test("still adopts a changed session when the state revision has not advanced", () => {
    // Session records reach the catalog through session-detail updates, which
    // never advance the digest - a revision short-circuit here would freeze
    // titles and ordering until the next full catalog snapshot.
    const current = { ...snapshot(), stateRevision: "rev-1" }
    const renamed = { ...session("ses_live", 2), title: "renamed" }
    const merged = mergeSessionCardSnapshot(current, {
      ...cardSnapshot(current),
      sessions: [renamed],
      stateRevision: "rev-1",
    })

    expect(merged).not.toBe(current)
    expect(merged.sessions[0]?.title).toBe("renamed")
  })
})

function syncEvent(name: string, properties: Record<string, unknown>): GlobalEvent {
  return { payload: { type: "sync", name, properties } } as GlobalEvent
}

function event(type: string, properties: Record<string, unknown>): GlobalEvent {
  return { payload: { type, properties } } as GlobalEvent
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
    terminalSessions: [],
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
    terminalSessions: [...current.terminalSessions],
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
