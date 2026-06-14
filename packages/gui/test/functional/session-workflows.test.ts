import { describe, expect, test } from "bun:test"
import { nextPromptHistoryState, textPrompt } from "../../src/renderer/src/lib/prompt-state"
import { runSessionPromptAction } from "../../src/renderer/src/lib/session-prompt"
import { buildSessionSlashCommands } from "../../src/renderer/src/lib/session-slash-commands"
import { command, gui, session } from "./fixtures"

describe("GUI functional session workflows", () => {
  test("sends a new-session prompt through creation, model memory, sync, refresh, and route handoff", async () => {
    const calls: string[] = []

    await runSessionPromptAction({
      gui: gui(),
      route: { name: "new-session", projectID: "project-1" },
      session: session("draft"),
      text: " build it ",
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
      "send:created:build it:build:anthropic/claude-sonnet:fast",
      "remember:anthropic/claude-sonnet",
      "sync:created",
      "refresh",
      "route:created",
    ])
  })

  test("routes backend slash commands without sending a normal prompt", async () => {
    const calls: string[] = []

    await runSessionPromptAction({
      gui: gui(),
      route: { name: "session" },
      session: session("session-1"),
      text: "/review staged changes",
      permissionCount: 0,
      questionCount: 0,
      agent: "build",
      model: "",
      variant: "",
      setPrompt: (value) => calls.push(`prompt:${value}`),
      setLoadingSessionID: (sessionID) => calls.push(`loading:${sessionID}`),
      sendPrompt: async () => calls.push("send"),
      runCommand: async (sessionID, name, args) => calls.push(`command:${sessionID}:${name}:${args}`),
      serverCommands: [command("review")],
      rememberModel: () => calls.push("remember"),
      syncSession: async (sessionID) => calls.push(`sync:${sessionID}`),
      refresh: async () => calls.push("refresh"),
      openCreatedSession: () => calls.push("route"),
    })

    expect(calls).toEqual(["prompt:", "loading:session-1", "command:session-1:review:staged changes", "sync:session-1", "refresh"])
  })

  test("exposes local TUI parity slash commands through the composer catalog", async () => {
    const calls: string[] = []
    const commands = buildSessionSlashCommands({
      shared: false,
      canRedo: true,
      variantCount: 2,
      actions: Object.fromEntries([
        "switchSession",
        "createSession",
        "openDashboard",
        "createProject",
        "openSwarms",
        "openSwarm",
        "createSwarm",
        "createSwarmTask",
        "openView",
        "createView",
        "editView",
        "deleteView",
        "createProjectSession",
        "manageWorkspaces",
        "switchModel",
        "switchAgent",
        "toggleMcps",
        "switchVariant",
        "connectProvider",
        "switchOrg",
        "viewStatus",
        "switchTheme",
        "showHelp",
        "exitApp",
        "openEditor",
        "openSkills",
        "warpWorkspace",
        "openDiff",
        "shareSession",
        "renameSession",
        "forkSession",
        "compactSession",
        "unshareSession",
        "undoMessage",
        "redoMessage",
        "toggleCodeConceal",
        "toggleTimestamps",
        "toggleThinking",
        "toggleToolDetails",
        "toggleScrollbar",
        "toggleGenericToolOutput",
        "copyTranscript",
        "exportTranscript",
      ].map((name) => [name, () => calls.push(name)])),
    })

    await commands.find((item) => item.name === "scrollbar")?.run()
    await commands.find((item) => item.name === "export")?.run()

    expect(commands.map((item) => item.name)).toContain("scrollbar")
    expect(commands.find((item) => item.name === "scrollbar")?.aliases).toEqual(["toggle-scrollbar"])
    expect(calls).toEqual(["toggleScrollbar", "exportTranscript"])
  })

  test("restores prompt history and returns down-arrow navigation to an empty newest draft", () => {
    const first = nextPromptHistoryState({
      history: ["first prompt", "latest prompt"],
      offset: -1,
      historyIndex: -1,
      historyDraft: "",
      draftPrompt: "",
    })
    const newest = first && nextPromptHistoryState({
      history: ["first prompt", "latest prompt"],
      offset: 1,
      historyIndex: first.historyIndex,
      historyDraft: first.historyDraft,
      draftPrompt: first.draftPrompt,
    })

    expect(textPrompt(first?.draftPrompt ?? "")).toEqual({ input: "latest prompt", parts: [{ type: "text", text: "latest prompt" }] })
    expect(newest?.draftPrompt).toBe("")
    expect(newest?.historyIndex).toBe(-1)
  })
})
