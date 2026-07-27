import { describe, expect, test } from "bun:test"
import { guiShortcutAction, runGuiShortcutAction } from "../../src/renderer/src/lib/keyboard-shortcuts"
import { runCycleVariantAction, runSwitchAgentAction, runSwitchModelAction, runSwitchVariantAction } from "../../src/renderer/src/lib/model-actions"
import { buildPaletteCommands } from "../../src/renderer/src/lib/palette-commands"
import { agent, provider } from "./fixtures"

describe("GUI functional control workflows", () => {
  test("switches model, agent, and variant from picker-style choices", async () => {
    const calls: string[] = []

    await runSwitchModelAction({
      providers: [provider()],
      alert: (message) => calls.push(`alert:${message}`),
      askChoice: async (input) => {
        calls.push(`model-options:${input.options.map((item) => item.value).join(",")}`)
        return "anthropic/claude-sonnet"
      },
      setSelectedModel: (value) => calls.push(`model:${value}`),
      setSelectedVariant: (value) => calls.push(`variant:${value}`),
      rememberModel: (value) => calls.push(`remember:${value}`),
    })
    await runSwitchAgentAction({
      agents: [agent(), agent({ name: "hidden", hidden: true }), agent({ name: "sub", mode: "subagent" })],
      alert: (message) => calls.push(`alert:${message}`),
      askChoice: async (input) => {
        calls.push(`agent-options:${input.options.map((item) => item.value).join(",")}`)
        return "build"
      },
      setSelectedAgent: (value) => calls.push(`agent:${value}`),
    })
    await runSwitchVariantAction({
      providers: [provider()],
      selectedModel: "anthropic/claude-sonnet",
      alert: (message) => calls.push(`alert:${message}`),
      askChoice: async (input) => {
        calls.push(`variant-options:${input.options.map((item) => item.value || "default").join(",")}`)
        return "fast"
      },
      setSelectedVariant: (value) => calls.push(`variant:${value}`),
    })
    runCycleVariantAction({
      providers: [provider()],
      selectedModel: "anthropic/claude-sonnet",
      selectedVariant: "fast",
      alert: (message) => calls.push(`alert:${message}`),
      setSelectedVariant: (value) => calls.push(`cycle:${value}`),
    })

    expect(calls).toEqual([
      "model-options:anthropic/claude-sonnet",
      "model:anthropic/claude-sonnet",
      "variant:",
      "remember:anthropic/claude-sonnet",
      "agent-options:build",
      "agent:build",
      "variant-options:default,fast,slow",
      "variant:fast",
      "cycle:slow",
    ])
  })

  test("runs keyboard shortcuts through the same command handlers users trigger", () => {
    const calls: string[] = []
    const actions = [
      guiShortcutAction({ key: "p", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { editing: false, dialogOpen: false, noticeVisible: false }),
      guiShortcutAction({ key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, { editing: false, dialogOpen: false, noticeVisible: false }),
      guiShortcutAction({ key: "?", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { editing: false, dialogOpen: false, noticeVisible: false }),
    ].filter((item): item is NonNullable<typeof item> => item !== undefined)

    actions.forEach((action) => runGuiShortcutAction(action, {
      abortSession: (sessionID) => calls.push(`abort:${sessionID}`),
      clearNotice: () => calls.push("clear"),
      openCommandPalette: () => calls.push("palette"),
      toggleRail: () => calls.push("rail"),
      focusComposer: () => calls.push("focus"),
      createSession: () => calls.push("new"),
      refresh: () => calls.push("refresh"),
      showKeyboardHelp: () => calls.push("help"),
      copyLastAssistantMessage: () => calls.push("copy-last"),
      transcript: (action) => calls.push(`transcript:${action}`),
      route: (route) => calls.push(`route:${route}`),
    }))

    expect(calls).toEqual(["palette", "transcript:next", "help"])
  })

  test("command palette exposes release-critical workflow commands", async () => {
    const calls: string[] = []
    const commands = buildPaletteCommands({
      visibleSessionCount: 2,
      currentRouteName: "session",
      workspacePath: "C:/Work/OpencodeX",
      variantCount: 2,
      actions: {
        switchSession: () => calls.push("switch-session"),
        createSession: () => calls.push("new-session"),
        openRoute: (name) => calls.push(`route:${name}`),
        createProject: () => calls.push("create-project"),
        createProjectSession: () => calls.push("project-session"),
        toggleRail: () => calls.push("rail"),
        focusSidebar: () => calls.push("sidebar"),
        createSwarm: () => calls.push("swarm"),
        createSwarmTask: () => calls.push("swarm-task"),
        createView: () => calls.push("view"),
        editView: () => calls.push("edit-view"),
        deleteView: () => calls.push("delete-view"),
        manageWorkspaces: () => calls.push("workspaces"),
        copyWorkspacePath: () => calls.push("copy-path"),
        switchModel: () => calls.push("model"),
        switchAgent: () => calls.push("agent"),
        toggleMcps: () => calls.push("mcps"),
        cycleVariant: () => calls.push("cycle"),
        switchVariant: () => calls.push("variant"),
        connectProvider: () => calls.push("connect"),
        switchOrg: () => calls.push("org"),
        switchTheme: () => calls.push("theme"),
        showHelp: () => calls.push("help"),
        showKeyboardHelp: () => calls.push("keyboard"),
        copyLastAssistantMessage: () => calls.push("copy-last"),
        copyTranscript: () => calls.push("copy-transcript"),
        toggleCodeConceal: () => calls.push("conceal"),
        toggleTimestamps: () => calls.push("timestamps"),
        toggleThinking: () => calls.push("thinking"),
        toggleToolDetails: () => calls.push("tool-details"),
        toggleScrollbar: () => calls.push("scrollbar"),
        toggleGenericToolOutput: () => calls.push("generic-output"),
        transcriptFirst: () => calls.push("first"),
        transcriptLast: () => calls.push("last"),
        transcriptNextMessage: () => calls.push("next"),
        transcriptPreviousMessage: () => calls.push("previous"),
        transcriptLastUser: () => calls.push("last-user"),
        focusComposer: () => calls.push("focus-composer"),
        refresh: () => calls.push("refresh"),
        installPlugin: () => calls.push("install-plugin"),
        openDocs: () => calls.push("docs"),
        exitApp: () => calls.push("exit"),
      },
    })

    await commands.find((item) => item.name === "session.toggle.scrollbar")?.run()
    await commands.find((item) => item.name === "plugins.install")?.run()
    await commands.find((item) => item.name === "session.message.next")?.run()

    expect(commands.find((item) => item.name === "which-key.toggle")?.shortcut).toBe("Ctrl+?")
    expect(commands.find((item) => item.name === "messages.copy")?.shortcut).toBe("Ctrl+Shift+C")
    expect(calls).toEqual(["scrollbar", "install-plugin", "next"])
  })
})
