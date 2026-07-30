import type { PaletteCommand } from "../components/command-palette"
import { buildPaletteSystemCommands } from "./palette-system-commands"

type PaletteRouteName = "dashboard" | "sessions" | "projects" | "swarms" | "views" | "plugins" | "settings" | "status"

export type PaletteCommandActions = {
  switchSession: () => void | Promise<void>
  createSession: () => void | Promise<void>
  openRoute: (name: PaletteRouteName) => void
  createProject: () => void | Promise<void>
  createProjectSession: () => void | Promise<void>
  toggleRail: () => void
  focusSidebar: () => void
  toggleWorkspace: () => void
  openWorkspace: (target: "context" | "files" | "git" | "terminal" | "web") => void
  createSwarm: () => void | Promise<void>
  startSwarmSession: () => void | Promise<void>
  createView: () => void | Promise<void>
  editView: () => void | Promise<void>
  deleteView: () => void | Promise<void>
  manageWorkspaces: () => void | Promise<void>
  copyWorkspacePath: () => void | Promise<void>
  switchModel: () => void | Promise<void>
  switchAgent: () => void | Promise<void>
  toggleMcps: () => void | Promise<void>
  cycleVariant: () => void | Promise<void>
  switchVariant: () => void | Promise<void>
  connectProvider: () => void | Promise<void>
  switchTheme: () => void | Promise<void>
  showHelp: () => void | Promise<void>
  showKeyboardHelp: () => void | Promise<void>
  copyLastAssistantMessage: () => void | Promise<void>
  copyTranscript: () => void | Promise<void>
  toggleCodeConceal: () => void | Promise<void>
  toggleTimestamps: () => void | Promise<void>
  toggleThinking: () => void | Promise<void>
  toggleToolDetails: () => void | Promise<void>
  toggleScrollbar: () => void | Promise<void>
  toggleGenericToolOutput: () => void | Promise<void>
  transcriptFirst: () => void
  transcriptLast: () => void
  transcriptNextMessage: () => void
  transcriptPreviousMessage: () => void
  transcriptLastUser: () => void
  focusComposer: () => void
  refresh: () => void | Promise<void>
  installPlugin: () => void | Promise<void>
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
      name: "opencodex.workspace.toggle",
      title: "Toggle session workspace",
      category: "Workspace",
      shortcut: "Ctrl+J",
      suggested: true,
      run: input.actions.toggleWorkspace,
    },
    ...(["git", "files", "terminal", "context", "web"] as const).map((target) => ({
      name: `opencodex.workspace.${target}`,
      title: `Open workspace ${target === "web" ? "webpage" : target}`,
      category: "Workspace",
      run: () => input.actions.openWorkspace(target),
    })),
    {
      name: "opencodex.swarm.open",
      title: "Open swarms",
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
      name: "opencodex.swarm.session",
      title: "Start swarm session",
      category: "Swarms",
      suggested: true,
      run: input.actions.startSwarmSession,
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
      run: input.actions.editView,
    },
    {
      name: "opencodex.view.delete",
      title: "Delete view",
      category: "Views",
      suggested: true,
      run: input.actions.deleteView,
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
      run: input.actions.manageWorkspaces,
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
      run: input.actions.toggleMcps,
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
      run: input.actions.connectProvider,
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
      run: input.actions.switchTheme,
    },
    {
      name: "help.show",
      title: "Help",
      category: "System",
      shortcut: "Ctrl+?",
      run: input.actions.showHelp,
    },
    {
      name: "which-key.toggle",
      title: "Keyboard shortcuts",
      category: "System",
      shortcut: "Ctrl+?",
      run: input.actions.showKeyboardHelp,
    },
    {
      name: "messages.copy",
      title: "Copy last assistant message",
      category: "Session",
      shortcut: "Ctrl+Shift+C",
      run: input.actions.copyLastAssistantMessage,
    },
    {
      name: "session.copy",
      title: "Copy session transcript",
      category: "Session",
      run: input.actions.copyTranscript,
    },
    {
      name: "session.toggle.conceal",
      title: "Toggle code concealment",
      category: "Session",
      run: input.actions.toggleCodeConceal,
    },
    {
      name: "session.toggle.timestamps",
      title: "Toggle timestamps",
      category: "Session",
      run: input.actions.toggleTimestamps,
    },
    {
      name: "session.toggle.thinking",
      title: "Toggle thinking",
      category: "Session",
      run: input.actions.toggleThinking,
    },
    {
      name: "session.toggle.actions",
      title: "Toggle tool details",
      category: "Session",
      run: input.actions.toggleToolDetails,
    },
    {
      name: "session.toggle.scrollbar",
      title: "Toggle session scrollbar",
      category: "Session",
      run: input.actions.toggleScrollbar,
    },
    {
      name: "session.toggle.generic_tool_output",
      title: "Toggle generic tool output",
      category: "Session",
      run: input.actions.toggleGenericToolOutput,
    },
    {
      name: "session.first",
      title: "First message",
      category: "Session",
      shortcut: "Alt+Home",
      run: input.actions.transcriptFirst,
    },
    {
      name: "session.last",
      title: "Last message",
      category: "Session",
      shortcut: "Alt+End",
      run: input.actions.transcriptLast,
    },
    {
      name: "session.message.next",
      title: "Next message",
      category: "Session",
      shortcut: "Alt+Down",
      run: input.actions.transcriptNextMessage,
    },
    {
      name: "session.message.previous",
      title: "Previous message",
      category: "Session",
      shortcut: "Alt+Up",
      run: input.actions.transcriptPreviousMessage,
    },
    {
      name: "session.messages_last_user",
      title: "Jump to last user message",
      category: "Session",
      shortcut: "Alt+U",
      run: input.actions.transcriptLastUser,
    },
    ...buildPaletteSystemCommands(input.actions),
  ]
}
