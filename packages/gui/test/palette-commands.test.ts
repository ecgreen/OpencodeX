import { describe, expect, test } from "bun:test"
import { buildPaletteCommands } from "../src/renderer/src/lib/palette-commands"

describe("GUI palette command catalog", () => {
  test("builds command metadata from app state", () => {
    const commands = buildPaletteCommands({
      visibleSessionCount: 3,
      currentRouteName: "session",
      workspacePath: "C:\\Work\\OpencodeX",
      variantCount: 0,
      actions: actions([]),
    })

    expect(command(commands, "session.list")).toMatchObject({
      title: "Switch session",
      description: "3 available sessions",
      suggested: true,
    })
    expect(command(commands, "session.new")?.suggested).toBe(true)
    expect(command(commands, "workspace.copy_path")?.description).toBe("C:\\Work\\OpencodeX")
    expect(command(commands, "variant.list")?.disabled).toBe("The selected model does not expose variants.")
  })

  test("routes commands through injected app actions", async () => {
    const calls: string[] = []
    const commands = buildPaletteCommands({
      visibleSessionCount: 0,
      currentRouteName: "dashboard",
      variantCount: 2,
      actions: actions(calls),
    })

    await command(commands, "opencodex.dashboard.open")?.run()
    await command(commands, "opencodex.session.new_project")?.run()
    await command(commands, "docs.open")?.run()
    await command(commands, "app.exit")?.run()

    expect(command(commands, "variant.list")?.disabled).toBeUndefined()
    expect(calls).toEqual(["route:dashboard", "create-project-session", "open-docs", "exit"])
  })
})

function command(commands: ReturnType<typeof buildPaletteCommands>, name: string) {
  return commands.find((item) => item.name === name)
}

function actions(calls: string[]) {
  return {
    switchSession: () => calls.push("switch-session"),
    createSession: () => calls.push("create-session"),
    openRoute: (name: string) => calls.push(`route:${name}`),
    createProject: () => calls.push("create-project"),
    createProjectSession: () => calls.push("create-project-session"),
    toggleRail: () => calls.push("toggle-rail"),
    focusSidebar: () => calls.push("focus-sidebar"),
    createSwarm: () => calls.push("create-swarm"),
    createView: () => calls.push("create-view"),
    copyWorkspacePath: () => calls.push("copy-path"),
    switchModel: () => calls.push("switch-model"),
    switchAgent: () => calls.push("switch-agent"),
    cycleVariant: () => calls.push("cycle-variant"),
    switchVariant: () => calls.push("switch-variant"),
    showHelp: () => calls.push("show-help"),
    focusComposer: () => calls.push("focus-composer"),
    refresh: () => calls.push("refresh"),
    openDocs: () => calls.push("open-docs"),
    exitApp: () => calls.push("exit"),
  }
}
