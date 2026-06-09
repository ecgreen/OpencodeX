import { describe, expect, test } from "bun:test"
import { buildSessionSlashCommands } from "../src/renderer/src/lib/session-slash-commands"

describe("GUI session slash command catalog", () => {
  test("includes the TUI session slash commands and aliases", () => {
    const commands = buildSessionSlashCommands({
      shared: true,
      canRedo: true,
      variantCount: 2,
      actions: actions([]),
    })

    expect(commands.map((command) => command.name)).toEqual([
      "sessions",
      "new",
      "dashboard",
      "project",
      "swarm-dash",
      "open-swarm",
      "new-swarm",
      "swarm",
      "view",
      "new-view",
      "edit-view",
      "delete-view",
      "nsip",
      "workspaces",
      "models",
      "agents",
      "mcps",
      "variants",
      "connect",
      "org",
      "status",
      "themes",
      "help",
      "exit",
      "editor",
      "skills",
      "warp",
      "diff",
      "share",
      "rename",
      "timeline",
      "fork",
      "compact",
      "unshare",
      "undo",
      "redo",
      "timestamps",
      "thinking",
      "copy",
      "export",
    ])
    expect(command(commands, "models")?.aliases).toEqual(["model"])
    expect(command(commands, "compact")?.aliases).toEqual(["summarize"])
    expect(command(commands, "timestamps")?.aliases).toEqual(["toggle-timestamps"])
    expect(command(commands, "thinking")?.aliases).toEqual(["toggle-thinking"])
    expect(command(commands, "connect")?.disabled).toBeUndefined()
  })

  test("routes implemented command actions through injected handlers", async () => {
    const calls: string[] = []
    const commands = buildSessionSlashCommands({
      shared: false,
      canRedo: false,
      variantCount: 0,
      actions: actions(calls),
    })

    await command(commands, "models")?.run()
    await command(commands, "agents")?.run()
    await command(commands, "connect")?.run()
    await command(commands, "mcps")?.run()
    await command(commands, "org")?.run()
    await command(commands, "rename")?.run()
    await command(commands, "copy")?.run()

    expect(command(commands, "unshare")?.disabled).toBe("This session is not shared.")
    expect(command(commands, "redo")?.disabled).toBe("No message to redo.")
    expect(command(commands, "variants")?.disabled).toBe("The selected model does not expose variants.")
    expect(calls).toEqual(["model", "agent", "connect", "mcps", "org", "rename", "copy"])
  })
})

function command(commands: ReturnType<typeof buildSessionSlashCommands>, name: string) {
  return commands.find((item) => item.name === name)
}

function actions(calls: string[]) {
  return {
    switchSession: () => calls.push("sessions"),
    createSession: () => calls.push("new"),
    openDashboard: () => calls.push("dashboard"),
    createProject: () => calls.push("project"),
    openSwarms: () => calls.push("swarms"),
    openSwarm: () => calls.push("open-swarm"),
    createSwarm: () => calls.push("new-swarm"),
    createSwarmTask: () => calls.push("swarm"),
    openView: () => calls.push("view"),
    createView: () => calls.push("new-view"),
    editView: () => calls.push("edit-view"),
    deleteView: () => calls.push("delete-view"),
    createProjectSession: () => calls.push("nsip"),
    manageWorkspaces: () => calls.push("workspaces"),
    switchModel: () => calls.push("model"),
    switchAgent: () => calls.push("agent"),
    toggleMcps: () => calls.push("mcps"),
    switchVariant: () => calls.push("variants"),
    connectProvider: () => calls.push("connect"),
    switchOrg: () => calls.push("org"),
    viewStatus: () => calls.push("status"),
    switchTheme: () => calls.push("themes"),
    showHelp: () => calls.push("help"),
    exitApp: () => calls.push("exit"),
    openEditor: () => calls.push("editor"),
    openSkills: () => calls.push("skills"),
    warpWorkspace: () => calls.push("warp"),
    openDiff: () => calls.push("diff"),
    shareSession: () => calls.push("share"),
    renameSession: () => calls.push("rename"),
    openTimeline: () => calls.push("timeline"),
    forkSession: () => calls.push("fork"),
    compactSession: () => calls.push("compact"),
    unshareSession: () => calls.push("unshare"),
    undoMessage: () => calls.push("undo"),
    redoMessage: () => calls.push("redo"),
    toggleTimestamps: () => calls.push("timestamps"),
    toggleThinking: () => calls.push("thinking"),
    copyTranscript: () => calls.push("copy"),
    exportTranscript: () => calls.push("export"),
  }
}
