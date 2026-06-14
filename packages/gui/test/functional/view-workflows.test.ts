import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { eventSessionID, markViewSessionsLoaded, mergeLiveSessionData, patchVisibleViewSessionData } from "../../src/renderer/src/lib/live-session-patch"
import { textPrompt } from "../../src/renderer/src/lib/prompt-state"
import { runViewPromptAction } from "../../src/renderer/src/lib/view-prompt"
import {
  EMPTY_VIEW_PANE_RUNTIME_STATE,
  pruneRecordKeys,
  updateViewPaneRuntimeState,
} from "../../src/renderer/src/lib/view-pane-state"
import { metadataWithPendingSessions, viewItemID, viewItemsMembershipKey, viewSessionsSyncKey, type ViewItem } from "../../src/renderer/src/lib/view-items"
import { assistantMessage, command, gui, session, sessionData, userMessage, view } from "./fixtures"

describe("GUI functional view workflows", () => {
  test("keeps a focused pane composer while a sibling pane streams live updates", () => {
    const paneA = { ...EMPTY_VIEW_PANE_RUNTIME_STATE, draft: textPrompt("half-written prompt") }
    const currentState = { "session-a": paneA, "session-b": EMPTY_VIEW_PANE_RUNTIME_STATE }
    const nextState = updateViewPaneRuntimeState(currentState, "session-b", (state) => ({ ...state, loading: true, loadedTime: 10 }))
    const currentData = {
      "session-a": sessionData([userMessage("msg_a", "keep me")]),
      "session-b": sessionData([assistantMessage({ id: "msg_b", text: "start" })]),
    }
    const nextData = patchVisibleViewSessionData({
      data: currentData,
      sessionIDs: ["session-b"],
      event: event("message.part.delta", {
        messageID: "msg_b",
        partID: "msg_b-text",
        field: "text",
        delta: " streaming",
      }),
      limit: { count: 48, budget: 28_000 },
      emptyData: sessionData(),
    })
    const loadedTimes = markViewSessionsLoaded({}, ["session-b"], 11)

    expect(nextState["session-a"]).toBe(paneA)
    expect(nextData["session-a"]).toBe(currentData["session-a"])
    expect(nextData["session-b"]?.messages[0]?.parts[0]).toMatchObject({ text: "start streaming" })
    expect(loadedTimes["session-b"]).toBe(11)
  })

  test("separates view membership from volatile session sync metadata", () => {
    const items: ViewItem[] = [
      { kind: "session", session: session("session-a", { time: { created: 1, updated: 1 } }) },
      { kind: "session", session: session("session-b", { time: { created: 1, updated: 1 } }) },
    ]
    const updated = items.map((item) => item.kind === "session" && item.session.id === "session-b"
      ? { kind: "session" as const, session: session("session-b", { time: { created: 1, updated: 99 } }) }
      : item)

    expect(viewItemsMembershipKey("view-1", items)).toBe(viewItemsMembershipKey("view-1", updated))
    expect(viewSessionsSyncKey("view-1", items.map((item) => item.kind === "session" ? item.session : session("missing"))))
      .not.toBe(viewSessionsSyncKey("view-1", updated.map((item) => item.kind === "session" ? item.session : session("missing"))))
    expect(items.map(viewItemID)).toEqual(["session-a", "session-b"])
  })

  test("sends prompts from view panes and routes backend commands", async () => {
    const sendCalls: string[] = []
    const commandCalls: string[] = []
    const item: ViewItem = { kind: "session", session: session("session-1") }

    await runViewPromptAction({
      gui: gui(),
      item,
      view: view(),
      text: " hello ",
      agentForSession: () => "build",
      modelForSession: () => "anthropic/claude-sonnet",
      variantForSession: () => "fast",
      setDraftLoading: (draftID, loading) => sendCalls.push(`loading:${draftID}:${loading}`),
      setFocusedSessionID: (sessionID) => sendCalls.push(`focus:${sessionID}`),
      alert: (message) => sendCalls.push(`alert:${message}`),
      sendPrompt: async (sessionID, text, options) => sendCalls.push(`send:${sessionID}:${text}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}:${options.variant}`),
      rememberModel: (model) => sendCalls.push(`remember:${model}`),
      syncViewSession: async (session) => sendCalls.push(`sync:${session.id}`),
      refresh: async () => sendCalls.push("refresh"),
      prepareTarget: async () => ({ type: "ready", draftSession: item.session, target: item.session, focusSessionID: "session-1" }),
    })

    await runViewPromptAction({
      gui: gui(),
      item,
      view: view(),
      text: "/review staged changes",
      agentForSession: () => "build",
      modelForSession: () => "",
      variantForSession: () => "",
      setDraftLoading: () => undefined,
      setFocusedSessionID: (sessionID) => commandCalls.push(`focus:${sessionID}`),
      alert: (message) => commandCalls.push(`alert:${message}`),
      sendPrompt: async () => commandCalls.push("send"),
      runCommand: async (sessionID, name, args) => commandCalls.push(`command:${sessionID}:${name}:${args}`),
      serverCommands: [command("review")],
      rememberModel: () => commandCalls.push("remember"),
      syncViewSession: async (session) => commandCalls.push(`sync:${session.id}`),
      refresh: async () => commandCalls.push("refresh"),
      prepareTarget: async () => ({ type: "ready", draftSession: item.session, target: item.session, focusSessionID: "session-1" }),
    })

    expect(sendCalls).toEqual([
      "focus:session-1",
      "send:session-1:hello:build:anthropic/claude-sonnet:fast",
      "remember:anthropic/claude-sonnet",
      "sync:session-1",
      "refresh",
    ])
    expect(commandCalls).toEqual(["focus:session-1", "command:session-1:review:staged changes", "sync:session-1", "refresh"])
  })

  test("keeps pending panes in view metadata and prunes runtime state only when panes leave", () => {
    const metadata = metadataWithPendingSessions(undefined, [{ id: "new:project-1:1:0", projectID: "project-1", directory: "C:/Work/OpencodeX" }])
    const current = {
      "session-a": EMPTY_VIEW_PANE_RUNTIME_STATE,
      "new:project-1:1:0": { ...EMPTY_VIEW_PANE_RUNTIME_STATE, draft: textPrompt("pending prompt") },
    }

    expect(metadata.opencodex).toEqual({
      pendingSessions: [{ id: "new:project-1:1:0", projectID: "project-1", directory: "C:/Work/OpencodeX" }],
    })
    expect(pruneRecordKeys(current, new Set(["session-a", "new:project-1:1:0"]))).toBe(current)
    expect(pruneRecordKeys(current, new Set(["session-a"]))).toEqual({ "session-a": EMPTY_VIEW_PANE_RUNTIME_STATE })
  })

  test("merges polling reloads without overwriting newer streamed text", () => {
    const streamed = mergeLiveSessionData(
      sessionData([assistantMessage({ id: "msg_live", text: "hello world" })]),
      sessionData([assistantMessage({ id: "msg_live", text: "hello" })]),
    )

    expect(eventSessionID(event("session.updated", { sessionID: "session-1" }))).toBe("session-1")
    expect(streamed.messages[0]?.parts[0]).toMatchObject({ text: "hello world" })
  })
})

function event(type: string, properties: Record<string, unknown>): GlobalEvent {
  return { payload: { type, properties } } as GlobalEvent
}
