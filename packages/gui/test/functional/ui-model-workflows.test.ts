import type { LspStatus, McpStatus, Provider } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import type { PaletteCommand } from "../../src/renderer/src/components/command-palette"
import { keyboardHelpGroups } from "../../src/renderer/src/components/keyboard-help"
import { filterGuiPluginPagePlugins, filterPluginPagePlugins, guiPluginPageStats, pluginPageGroups, pluginPageStats } from "../../src/renderer/src/components/plugins-page"
import type { InstalledGuiPlugin } from "../../src/renderer/src/lib/gui-plugins"
import { sessionInspectorModel } from "../../src/renderer/src/components/session-inspector"
import type { GuiPlugin, SessionData } from "../../src/renderer/src/lib/store"
import { assistantMessage, provider, session } from "./fixtures"

describe("GUI functional UI model workflows", () => {
  test("derives plugin management stats, filters, and groups from visible plugin data", () => {
    const plugins = [
      plugin({ id: "tui-plugin", kind: "tui", spec: "local-tui", scope: "local", enabled: true, active: true }),
      plugin({ id: "server-plugin", kind: "server", spec: "global-server", scope: "global", enabled: false, active: false }),
      plugin({ id: "internal-plugin", kind: "tui", spec: "built-in", scope: "internal", canToggle: false }),
    ]
    const filtered = filterPluginPagePlugins(plugins, "all", "server")
    const groups = pluginPageGroups(plugins)

    expect(pluginPageStats(plugins)).toEqual({ total: 3, active: 2, disabled: 1, internal: 1 })
    expect(filtered.map((item) => item.id)).toEqual(["server-plugin"])
    expect(filterPluginPagePlugins(plugins, "internal", "").map((item) => item.id)).toEqual(["internal-plugin"])
    expect(groups.map((group) => `${group.title}:${group.items.map((item) => item.id).join(",")}`)).toEqual([
      "TUI Plugins:tui-plugin,internal-plugin",
      "Server Plugins:server-plugin",
    ])
  })

  test("derives GUI plugin stats and search from installed declarative plugins", () => {
    const plugins: InstalledGuiPlugin[] = [
      guiPlugin("theme", { permissions: ["theme"], contributes: { theme: { variables: { "--primary": "#7aa2f7" } } } }),
      guiPlugin("review", { permissions: ["commands"], contributes: { commands: [{ id: "review", title: "Review", prompt: "Review this." }] } }),
    ]

    expect(guiPluginPageStats(plugins)).toEqual({ total: 2, enabled: 2, commands: 1, themes: 1 })
    expect(filterGuiPluginPagePlugins(plugins, "review").map((plugin) => plugin.manifest.id)).toEqual(["review"])
  })

  test("derives keyboard help groups from enabled command registry entries", () => {
    const commands: PaletteCommand[] = [
      { name: "session.copy", title: "Copy transcript", category: "Session", run: () => undefined },
      { name: "session.new", title: "New session", category: "Session", shortcut: "Ctrl+N", run: () => undefined },
      { name: "app.debug", title: "Debug", category: "System", disabled: "TUI-only command.", run: () => undefined },
      { name: "plugins.list", title: "Plugins", category: "System", shortcut: "Ctrl+4", run: () => undefined },
    ]

    expect(keyboardHelpGroups(commands, "").map((group) => ({
      category: group.category,
      commands: group.commands.map((command) => command.title),
    }))).toEqual([
      { category: "Session", commands: ["Copy transcript", "New session"] },
      { category: "System", commands: ["Plugins"] },
    ])
    expect(keyboardHelpGroups(commands, "ctrl+n")[0]?.commands.map((command) => command.title)).toEqual(["New session"])
  })

  test("derives session inspector context, status sections, todos, and modified files", () => {
    const model = sessionInspectorModel({
      session: session("session-1", { cost: 1.23 }),
      data: inspectorData(),
      providers: [providerWithLimit()],
      mcp: { "server-one": { status: "connected" } } as unknown as Record<string, McpStatus>,
      lsp: [{ id: "tsserver", name: "TypeScript", status: "connected", root: "C:/Work/OpencodeX" } as LspStatus],
    })

    expect(model.context).toEqual({ tokens: 2, percent: 2, cost: "$1.23" })
    expect(model.visibleSections).toEqual({ todo: true, files: true, mcp: true, lsp: true })
    expect(model.activeTodos.map((todo) => todo.content)).toEqual(["Fix bug"])
    expect(model.mcpRows.map(([name]) => name)).toEqual(["server-one"])
  })

  test("keeps completed todos hidden and shows LSP empty state when configured", () => {
    const model = sessionInspectorModel({
      session: session("session-1"),
      data: { messages: [], todos: [{ id: "done", content: "Done", status: "completed", priority: "low" }], diffs: [] } as SessionData,
      providers: [],
      mcp: {},
      lsp: [],
      lspEnabled: true,
    })

    expect(model.activeTodos).toEqual([])
    expect(model.visibleSections).toEqual({ todo: false, files: false, mcp: false, lsp: true })
  })
})

function plugin(input: Partial<GuiPlugin>): GuiPlugin {
  return {
    id: "plugin-1",
    pluginID: input.spec ?? "plugin-1",
    kind: "tui",
    spec: "plugin",
    source: "C:/Work/OpencodeX/plugin",
    scope: "local",
    enabled: true,
    active: true,
    canToggle: true,
    ...input,
  }
}

function guiPlugin(id: string, input: Partial<InstalledGuiPlugin["manifest"]>): InstalledGuiPlugin {
  return {
    enabled: true,
    installedAt: 1,
    source: "imported",
    manifest: {
      schema: "opencodex.gui.plugin/v1",
      id,
      name: id,
      version: "1.0.0",
      permissions: [],
      ...input,
    },
  }
}

function inspectorData(): SessionData {
  return {
    messages: [assistantMessage()],
    todos: [
      { id: "todo-1", content: "Fix bug", status: "pending", priority: "high" },
      { id: "todo-2", content: "Done", status: "completed", priority: "low" },
    ],
    diffs: [{ file: "src/app.ts", additions: 4, deletions: 1 }],
  } as SessionData
}

function providerWithLimit(): Provider {
  const base = provider()
  return {
    ...base,
    models: {
      ...base.models,
      "claude-sonnet": {
        ...base.models["claude-sonnet"],
        limit: { context: 100 },
      },
    },
  } as Provider
}
