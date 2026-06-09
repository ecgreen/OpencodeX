import type { PaletteCommand } from "../components/command-palette"

type PaletteRouteName = "dashboard" | "sessions" | "projects" | "swarms" | "views" | "status"

export type PaletteCommandActions = {
  switchSession: () => void | Promise<void>
  createSession: () => void | Promise<void>
  openRoute: (name: PaletteRouteName) => void
  createProject: () => void | Promise<void>
  createProjectSession: () => void | Promise<void>
  toggleRail: () => void
  focusSidebar: () => void
  createSwarm: () => void | Promise<void>
  createView: () => void | Promise<void>
  copyWorkspacePath: () => void | Promise<void>
  switchModel: () => void | Promise<void>
  switchAgent: () => void | Promise<void>
  cycleVariant: () => void | Promise<void>
  switchVariant: () => void | Promise<void>
  showHelp: () => void | Promise<void>
  focusComposer: () => void
  refresh: () => void | Promise<void>
  openDocs: () => void
  exitApp: () => void
}

export function buildPaletteCommands(input: {
  visibleSessionCount: number
  currentRouteName: string
  workspacePath?: string
  variantCount: number
  actions: PaletteCommandActions
}): PaletteCommand[] {
  return [
    {
      name: "session.list",
      title: "Switch session",
      category: "Session",
      description: `${input.visibleSessionCount} available sessions`,
      suggested: input.visibleSessionCount > 0,
      run: input.actions.switchSession,
    },
    {
      name: "session.new",
      title: "New session",
      category: "Session",
      suggested: input.currentRouteName === "session",
      run: input.actions.createSession,
    },
    {
      name: "opencodex.dashboard.open",
      title: "Open operations dashboard",
      category: "OpencodeX",
      suggested: true,
      run: () => input.actions.openRoute("dashboard"),
    },
    {
      name: "opencodex.project.create",
      title: "Create project",
      category: "OpencodeX",
      suggested: true,
      run: input.actions.createProject,
    },
    {
      name: "opencodex.session.new_project",
      title: "New session in project",
      category: "OpencodeX",
      suggested: true,
      run: input.actions.createProjectSession,
    },
    {
      name: "opencodex.session.manage",
      title: "Manage sessions",
      category: "OpencodeX",
      run: () => input.actions.openRoute("sessions"),
    },
    {
      name: "opencodex.project.manage",
      title: "Manage projects",
      category: "OpencodeX",
      run: () => input.actions.openRoute("projects"),
    },
    {
      name: "opencodex.sidebar.toggle",
      title: "Toggle sidebar",
      category: "OpencodeX",
      suggested: true,
      run: input.actions.toggleRail,
    },
    {
      name: "opencodex.sidebar.focus",
      title: "Focus sidebar",
      category: "OpencodeX",
      suggested: true,
      run: input.actions.focusSidebar,
    },
    {
      name: "opencodex.swarm.list",
      title: "Show swarms on dashboard",
      category: "Swarms",
      suggested: true,
      run: () => input.actions.openRoute("swarms"),
    },
    {
      name: "opencodex.swarm.open",
      title: "Open swarm",
      category: "Swarms",
      suggested: true,
      run: () => input.actions.openRoute("swarms"),
    },
    {
      name: "opencodex.swarm.create",
      title: "Create swarm",
      category: "Swarms",
      suggested: true,
      run: input.actions.createSwarm,
    },
    {
      name: "opencodex.swarm.task",
      title: "New swarm task",
      category: "Swarms",
      suggested: true,
      disabled: "GUI swarm task picker is not implemented yet.",
      run: () => {},
    },
    {
      name: "opencodex.view.open",
      title: "Open view",
      category: "Views",
      suggested: true,
      run: () => input.actions.openRoute("views"),
    },
    {
      name: "opencodex.view.create",
      title: "Create view",
      category: "Views",
      suggested: true,
      run: input.actions.createView,
    },
    {
      name: "opencodex.view.edit",
      title: "Edit view",
      category: "Views",
      suggested: true,
      disabled: "GUI view editing is not implemented yet.",
      run: () => {},
    },
    {
      name: "opencodex.view.delete",
      title: "Delete view",
      category: "Views",
      suggested: true,
      disabled: "GUI view deletion is not implemented yet.",
      run: () => {},
    },
    {
      name: "workspace.copy_path",
      title: "Copy worktree path",
      category: "Workspace",
      description: input.workspacePath,
      run: input.actions.copyWorkspacePath,
    },
    {
      name: "workspace.list",
      title: "Manage workspaces",
      category: "Workspace",
      disabled: "GUI workspace management is not implemented yet.",
      run: () => {},
    },
    {
      name: "model.list",
      title: "Switch model",
      category: "Agent",
      suggested: true,
      run: input.actions.switchModel,
    },
    {
      name: "agent.list",
      title: "Switch agent",
      category: "Agent",
      run: input.actions.switchAgent,
    },
    {
      name: "mcp.list",
      title: "Toggle MCPs",
      category: "Agent",
      disabled: "GUI MCP toggles are not implemented yet.",
      run: () => {},
    },
    {
      name: "variant.cycle",
      title: "Variant cycle",
      category: "Agent",
      run: input.actions.cycleVariant,
    },
    {
      name: "variant.list",
      title: "Switch model variant",
      category: "Agent",
      disabled: input.variantCount === 0 ? "The selected model does not expose variants." : undefined,
      run: input.actions.switchVariant,
    },
    {
      name: "provider.connect",
      title: "Connect provider",
      category: "Provider",
      disabled: "GUI provider connection flow is not implemented yet.",
      run: () => {},
    },
    {
      name: "console.org.switch",
      title: "Switch org",
      category: "Provider",
      disabled: "GUI console org switching is not implemented yet.",
      run: () => {},
    },
    {
      name: "opencode.status",
      title: "View status",
      category: "System",
      run: () => input.actions.openRoute("status"),
    },
    {
      name: "theme.switch",
      title: "Switch theme",
      category: "System",
      disabled: "GUI theme picker is not implemented yet.",
      run: () => {},
    },
    {
      name: "theme.switch_mode",
      title: "Switch theme mode",
      category: "System",
      disabled: "GUI theme mode switching is not implemented yet.",
      run: () => {},
    },
    {
      name: "theme.mode.lock",
      title: "Lock theme mode",
      category: "System",
      disabled: "GUI theme mode locking is not implemented yet.",
      run: () => {},
    },
    {
      name: "help.show",
      title: "Help",
      category: "System",
      run: input.actions.showHelp,
    },
    {
      name: "docs.open",
      title: "Open docs",
      category: "System",
      run: input.actions.openDocs,
    },
    {
      name: "app.exit",
      title: "Exit the app",
      category: "System",
      run: input.actions.exitApp,
    },
    {
      name: "app.debug",
      title: "Toggle debug panel",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.console",
      title: "Toggle console",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.heap_snapshot",
      title: "Write heap snapshot",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "terminal.title.toggle",
      title: "Toggle terminal title",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.animations",
      title: "Toggle animations",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.file_context",
      title: "Toggle file context",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.diffwrap",
      title: "Toggle diff wrapping",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.paste_summary",
      title: "Toggle paste summary",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.session_directory_filter",
      title: "Toggle session directory filtering",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "gui.composer.focus",
      title: "Focus composer",
      category: "System",
      shortcut: "Ctrl+/",
      run: input.actions.focusComposer,
    },
    {
      name: "gui.refresh",
      title: "Refresh GUI snapshot",
      category: "System",
      shortcut: "Ctrl+R",
      run: input.actions.refresh,
    },
  ]
}
