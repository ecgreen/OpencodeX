import { describe, expect, test } from "bun:test"
import type { Command, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "../src/renderer/src/lib/client"
import { textPrompt, type GuiPromptInfo } from "../src/renderer/src/lib/prompt-state"
import { prepareSessionPromptSendTarget, prepareSessionPromptSubmission, runSessionPromptAction } from "../src/renderer/src/lib/session-prompt"

describe("GUI session prompt decisions", () => {
  test("prepares submissions only when the selected composer can send", () => {
    const client = gui()
    const current = session("session-1")

    expect(prepareSessionPromptSubmission({
      gui: client,
      route: { name: "session" },
      session: current,
      prompt: textPrompt("hello"),
      permissionCount: 0,
      questionCount: 0,
    })).toEqual({ gui: client, route: { name: "session" }, session: current, prompt: textPrompt("hello") })
    expect(prepareSessionPromptSubmission({ gui: client, route: { name: "dashboard" }, session: current, prompt: textPrompt("hello"), permissionCount: 0, questionCount: 0 })).toBeUndefined()
    expect(prepareSessionPromptSubmission({ gui: client, route: { name: "session" }, session: current, prompt: textPrompt(""), permissionCount: 0, questionCount: 0 })).toBeUndefined()
    expect(prepareSessionPromptSubmission({ gui: client, route: { name: "session" }, session: current, prompt: textPrompt("hello"), permissionCount: 1, questionCount: 0 })).toBeUndefined()
    expect(prepareSessionPromptSubmission({ gui: client, route: { name: "session" }, session: current, prompt: textPrompt("hello"), permissionCount: 0, questionCount: 1 })).toBeUndefined()
  })

  test("prepares prompt send options and model memory", () => {
    expect(prepareSessionPromptSendTarget({
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

  test("runs session prompt sends through clear, load, send, sync, refresh, and route handoff", async () => {
    const calls: string[] = []

    await runSessionPromptAction({
      gui: gui(),
      route: { name: "new-session", projectID: "project-1" },
      session: session("draft"),
      text: " hello ",
      permissionCount: 0,
      questionCount: 0,
      agent: "build",
      model: "anthropic/claude-sonnet",
      variant: "fast",
      setPrompt: (value) => calls.push(`prompt:${value}`),
      setLoadingSessionID: (sessionID) => calls.push(`loading:${sessionID}`),
      sendPrompt: async (sessionID, text, options) => calls.push(`send:${sessionID}:${text}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}:${options.variant}`),
      rememberModel: (model) => calls.push(`remember:${model}`),
      syncSession: async (sessionID) => calls.push(`sync:${sessionID}`),
      refresh: async () => calls.push("refresh"),
      openCreatedSession: (sessionID) => calls.push(`route:${sessionID}`),
      prepareTarget: async () => ({ target: session("created"), createdSessionID: "created" }),
    })

    expect(calls).toEqual([
      "prompt:",
      "loading:draft",
      "send:created:hello:build:anthropic/claude-sonnet:fast",
      "remember:anthropic/claude-sonnet",
      "sync:created",
      "refresh",
      "route:created",
    ])
  })

  test("stops session prompt actions when blocked by pending permission requests", async () => {
    const calls: string[] = []

    await runSessionPromptAction({
      gui: gui(),
      route: { name: "session" },
      session: session("session-1"),
      text: "hello",
      permissionCount: 1,
      questionCount: 0,
      agent: "",
      model: "",
      variant: "",
      setPrompt: () => calls.push("prompt"),
      setLoadingSessionID: () => calls.push("loading"),
      sendPrompt: async () => calls.push("send"),
      rememberModel: () => calls.push("remember"),
      syncSession: async () => calls.push("sync"),
      refresh: async () => calls.push("refresh"),
      openCreatedSession: () => calls.push("route"),
    })

    expect(calls).toEqual([])
  })

  test("routes backend slash commands through session.command with selection and part payload", async () => {
    const calls: string[] = []
    const prompt: GuiPromptInfo = {
      input: "/review staged changes",
      parts: [
        { type: "text", text: "/review staged changes" },
        { type: "file", mime: "text/plain", filename: "src/app.ts", url: "file:///src/app.ts" },
      ],
    }

    await runSessionPromptAction({
      gui: gui(),
      route: { name: "session" },
      session: session("session-1"),
      text: prompt,
      permissionCount: 0,
      questionCount: 0,
      agent: "build",
      model: "anthropic/claude-sonnet",
      variant: "fast",
      setPrompt: (value) => calls.push(`prompt:${value}`),
      setLoadingSessionID: (sessionID) => calls.push(`loading:${sessionID}`),
      sendPrompt: async () => calls.push("send"),
      runCommand: async (sessionID, command, args, options) => calls.push(`command:${sessionID}:${command}:${args}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}:${options.variant}:${options.parts?.length}`),
      serverCommands: [command("review")],
      rememberModel: () => calls.push("remember"),
      syncSession: async (sessionID) => calls.push(`sync:${sessionID}`),
      refresh: async () => calls.push("refresh"),
      openCreatedSession: () => calls.push("route"),
    })

    expect(calls).toEqual([
      "prompt:",
      "loading:session-1",
      "command:session-1:review:staged changes:build:anthropic/claude-sonnet:fast:2",
      "remember",
      "sync:session-1",
      "refresh",
    ])
  })

  test("routes shell-mode prompts through session.shell", async () => {
    const calls: string[] = []

    await runSessionPromptAction({
      gui: gui(),
      route: { name: "session" },
      session: session("session-1"),
      text: "!bun test",
      permissionCount: 0,
      questionCount: 0,
      agent: "build",
      model: "anthropic/claude-sonnet",
      variant: "",
      setPrompt: (value) => calls.push(`prompt:${value}`),
      setLoadingSessionID: (sessionID) => calls.push(`loading:${sessionID}`),
      sendPrompt: async () => calls.push("send"),
      runShell: async (sessionID, shell, options) => calls.push(`shell:${sessionID}:${shell}:${options.agent}:${options.model?.providerID}/${options.model?.modelID}`),
      rememberModel: (model) => calls.push(`remember:${model}`),
      syncSession: async (sessionID) => calls.push(`sync:${sessionID}`),
      refresh: async () => calls.push("refresh"),
      openCreatedSession: () => calls.push("route"),
    })

    expect(calls).toEqual([
      "prompt:",
      "loading:session-1",
      "shell:session-1:bun test:build:anthropic/claude-sonnet",
      "remember:anthropic/claude-sonnet",
      "sync:session-1",
      "refresh",
    ])
  })
})

function gui(): GuiClient {
  return { directory: "C:/Work/OpencodeX" } as GuiClient
}

function session(id: string): Session {
  return { id, directory: "C:/Work/OpencodeX", time: { updated: 1 } } as Session
}

function command(name: string): Command {
  return { name, source: "command", template: "", hints: [] }
}
