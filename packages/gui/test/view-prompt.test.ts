import { describe, expect, test } from "bun:test"
import type { Command, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "../src/renderer/src/lib/client"
import { textPrompt, type GuiPromptInfo } from "../src/renderer/src/lib/prompt-state"
import { prepareViewPromptSendTarget, prepareViewPromptSubmission, prepareViewPromptTarget, runViewPromptAction } from "../src/renderer/src/lib/view-prompt"
import type { ViewItem } from "../src/renderer/src/lib/view-items"

describe("GUI view prompt decisions", () => {
  test("prepares submissions only when a client and text are available", () => {
    const item: ViewItem = { kind: "session", session: session("session-1") }
    const client = gui()

    expect(prepareViewPromptSubmission({ gui: client, item, prompt: textPrompt("hello") })).toEqual({
      gui: client,
      item,
      draftID: "session-1",
      prompt: textPrompt("hello"),
    })
    expect(prepareViewPromptSubmission({ item, prompt: textPrompt("hello") })).toBeUndefined()
    expect(prepareViewPromptSubmission({ gui: client, item, prompt: textPrompt("") })).toBeUndefined()
  })

  test("uses pending slot IDs for draft loading state", () => {
    const item: ViewItem = { kind: "pending", slot: { id: "pending-1", directory: "C:/Work/OpencodeX" } }

    expect(prepareViewPromptSubmission({ gui: gui(), item, prompt: textPrompt("start") })?.draftID).toBe("pending-1")
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
      prompt: textPrompt("hello"),
    })).toEqual({
      sessionID: "session-1",
      options: {
        directory: "C:/Work/OpencodeX",
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet" },
        variant: "fast",
        parts: [{ type: "text", text: "hello" }],
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

  test("routes backend slash commands through session.command with selection and part payload", async () => {
    const calls: string[] = []
    const item: ViewItem = { kind: "session", session: session("session-1") }
    const prompt: GuiPromptInfo = {
      input: "/review staged changes",
      parts: [
        { type: "text", text: "/review staged changes" },
        { type: "file", mime: "text/plain", filename: "src/app.ts", url: "file:///src/app.ts" },
      ],
    }

    await runViewPromptAction({
      gui: gui(),
      item,
      view: view(),
      text: prompt,
      agentForSession: () => "build",
      modelForSession: () => "anthropic/claude-sonnet",
      variantForSession: () => "fast",
      setDraftLoading: (draftID, loading) => calls.push(`loading:${draftID}:${loading}`),
      setFocusedSessionID: (sessionID) => calls.push(`focus:${sessionID}`),
      alert: (message) => calls.push(`alert:${message}`),
      sendPrompt: async () => calls.push("send"),
      runCommand: async (sessionID, command, args, options) => calls.push(`command:${sessionID}:${command}:${args}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}:${options.variant}:${options.parts?.length}`),
      serverCommands: [command("review")],
      rememberModel: (model) => calls.push(`remember:${model}`),
      syncViewSession: async (session) => calls.push(`sync:${session.id}`),
      refresh: async () => calls.push("refresh"),
      prepareTarget: async () => ({ type: "ready", draftSession: item.session, target: item.session, focusSessionID: "session-1" }),
    })

    expect(calls).toEqual([
      "focus:session-1",
      "command:session-1:review:staged changes:build:anthropic/claude-sonnet:fast:2",
      "remember:anthropic/claude-sonnet",
      "sync:session-1",
      "refresh",
    ])
  })

  test("routes shell-mode prompts through session.shell", async () => {
    const calls: string[] = []
    const item: ViewItem = { kind: "session", session: session("session-1") }

    await runViewPromptAction({
      gui: gui(),
      item,
      view: view(),
      text: "!bun test",
      agentForSession: () => "build",
      modelForSession: () => "anthropic/claude-sonnet",
      variantForSession: () => "",
      setDraftLoading: (draftID, loading) => calls.push(`loading:${draftID}:${loading}`),
      setFocusedSessionID: (sessionID) => calls.push(`focus:${sessionID}`),
      alert: (message) => calls.push(`alert:${message}`),
      sendPrompt: async () => calls.push("send"),
      runShell: async (sessionID, shell, options) => calls.push(`shell:${sessionID}:${shell}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}`),
      rememberModel: (model) => calls.push(`remember:${model}`),
      syncViewSession: async (session) => calls.push(`sync:${session.id}`),
      refresh: async () => calls.push("refresh"),
      prepareTarget: async () => ({ type: "ready", draftSession: item.session, target: item.session, focusSessionID: "session-1" }),
    })

    expect(calls).toEqual([
      "focus:session-1",
      "shell:session-1:bun test:build:anthropic/claude-sonnet",
      "remember:anthropic/claude-sonnet",
      "sync:session-1",
      "refresh",
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

function command(name: string): Command {
  return { name, source: "command", template: "", hints: [] }
}
