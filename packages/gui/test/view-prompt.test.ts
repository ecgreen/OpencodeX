import { describe, expect, test } from "bun:test"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "../src/renderer/src/lib/client"
import { prepareViewPromptSendTarget, prepareViewPromptSubmission, prepareViewPromptTarget, runViewPromptAction } from "../src/renderer/src/lib/view-prompt"
import type { ViewItem } from "../src/renderer/src/lib/view-items"

describe("GUI view prompt decisions", () => {
  test("prepares submissions only when a client and text are available", () => {
    const item: ViewItem = { kind: "session", session: session("session-1") }
    const client = gui()

    expect(prepareViewPromptSubmission({ gui: client, item, text: "  hello  " })).toEqual({
      gui: client,
      item,
      draftID: "session-1",
      text: "hello",
    })
    expect(prepareViewPromptSubmission({ item, text: "hello" })).toBeUndefined()
    expect(prepareViewPromptSubmission({ gui: client, item, text: "   " })).toBeUndefined()
  })

  test("uses pending slot IDs for draft loading state", () => {
    const item: ViewItem = { kind: "pending", slot: { id: "pending-1", directory: "C:/Work/OpencodeX" } }

    expect(prepareViewPromptSubmission({ gui: gui(), item, text: "start" })?.draftID).toBe("pending-1")
  })

  test("prepares existing session targets without creating a session", async () => {
    const item: ViewItem = { kind: "session", session: session("session-1") }

    expect(await prepareViewPromptTarget(gui(), item)).toEqual({
      type: "ready",
      draftSession: item.session,
      target: item.session,
    })
  })

  test("returns a notice when a pending session has no usable directory", async () => {
    const item: ViewItem = { kind: "pending", slot: { id: "pending-1" } }

    expect(await prepareViewPromptTarget(gui(""), item)).toEqual({
      type: "notice",
      message: "No directory available for this pending view session.",
    })
  })

  test("prepares prompt send options and model memory", () => {
    expect(prepareViewPromptSendTarget({
      target: session("session-1"),
      agent: "build",
      model: "anthropic/claude-sonnet",
      variant: "fast",
    })).toEqual({
      sessionID: "session-1",
      options: {
        directory: "C:/Work/OpencodeX",
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet" },
        variant: "fast",
      },
      modelToRemember: "anthropic/claude-sonnet",
    })
  })

  test("runs view prompt sends through loading, focus, send, sync, and refresh", async () => {
    const calls: string[] = []
    const item: ViewItem = { kind: "session", session: session("session-1") }

    await runViewPromptAction({
      gui: gui(),
      item,
      view: view(),
      text: " hello ",
      agentForSession: () => "build",
      modelForSession: () => "anthropic/claude-sonnet",
      variantForSession: () => "fast",
      setDraftLoading: (draftID, loading) => calls.push(`loading:${draftID}:${loading}`),
      setFocusedSessionID: (sessionID) => calls.push(`focus:${sessionID}`),
      alert: (message) => calls.push(`alert:${message}`),
      sendPrompt: async (sessionID, text, options) => calls.push(`send:${sessionID}:${text}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}:${options.variant}`),
      rememberModel: (model) => calls.push(`remember:${model}`),
      syncViewSession: async (session) => calls.push(`sync:${session.id}`),
      refresh: async () => calls.push("refresh"),
      prepareTarget: async () => ({ type: "ready", draftSession: item.session, target: item.session, focusSessionID: "session-1" }),
    })

    expect(calls).toEqual([
      "focus:session-1",
      "send:session-1:hello:build:anthropic/claude-sonnet:fast",
      "remember:anthropic/claude-sonnet",
      "sync:session-1",
      "refresh",
    ])
  })

  test("shows pending view prompt notices without sending", async () => {
    const calls: string[] = []

    await runViewPromptAction({
      gui: gui(""),
      item: { kind: "pending", slot: { id: "pending-1" } },
      text: "hello",
      agentForSession: () => "",
      modelForSession: () => "",
      variantForSession: () => "",
      setDraftLoading: (draftID, loading) => calls.push(`loading:${draftID}:${loading}`),
      setFocusedSessionID: (sessionID) => calls.push(`focus:${sessionID}`),
      alert: (message) => calls.push(`alert:${message}`),
      sendPrompt: async () => calls.push("send"),
      rememberModel: () => calls.push("remember"),
      syncViewSession: async () => calls.push("sync"),
      refresh: async () => calls.push("refresh"),
    })

    expect(calls).toEqual([
      "loading:pending-1:true",
      "alert:No directory available for this pending view session.",
      "loading:pending-1:false",
    ])
  })
})

function gui(directory = "C:/Work/OpencodeX"): GuiClient {
  return { directory } as GuiClient
}

function session(id: string): Session {
  return { id, directory: "C:/Work/OpencodeX", time: { updated: 1 } } as Session
}

function view(): OpencodeXView {
  return { id: "view-1", sessionIDs: ["session-1"], metadata: {} } as OpencodeXView
}
