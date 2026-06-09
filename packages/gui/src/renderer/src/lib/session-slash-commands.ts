export type SessionSlashCommandContext = {
  draftPrompt: string
  setDraftPrompt: (value: string) => void
  openModelPicker: () => void
}

export type SessionSlashCommand = {
  name: string
  title: string
  detail: string
  category: string
  aliases?: string[]
  disabled?: string
  run: (context?: SessionSlashCommandContext) => void | Promise<void>
}

export type SessionSlashCommandActions = {
  switchSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  createSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  openDashboard: (context?: SessionSlashCommandContext) => void | Promise<void>
  createProject: (context?: SessionSlashCommandContext) => void | Promise<void>
  openSwarms: (context?: SessionSlashCommandContext) => void | Promise<void>
  openSwarm: (context?: SessionSlashCommandContext) => void | Promise<void>
  createSwarm: (context?: SessionSlashCommandContext) => void | Promise<void>
  createSwarmTask: (context?: SessionSlashCommandContext) => void | Promise<void>
  openView: (context?: SessionSlashCommandContext) => void | Promise<void>
  createView: (context?: SessionSlashCommandContext) => void | Promise<void>
  editView: (context?: SessionSlashCommandContext) => void | Promise<void>
  deleteView: (context?: SessionSlashCommandContext) => void | Promise<void>
  createProjectSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  manageWorkspaces: (context?: SessionSlashCommandContext) => void | Promise<void>
  switchModel: (context?: SessionSlashCommandContext) => void | Promise<void>
  switchAgent: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleMcps: (context?: SessionSlashCommandContext) => void | Promise<void>
  switchVariant: (context?: SessionSlashCommandContext) => void | Promise<void>
  connectProvider: (context?: SessionSlashCommandContext) => void | Promise<void>
  switchOrg: (context?: SessionSlashCommandContext) => void | Promise<void>
  viewStatus: (context?: SessionSlashCommandContext) => void | Promise<void>
  switchTheme: (context?: SessionSlashCommandContext) => void | Promise<void>
  showHelp: (context?: SessionSlashCommandContext) => void | Promise<void>
  exitApp: (context?: SessionSlashCommandContext) => void | Promise<void>
  openEditor: (context?: SessionSlashCommandContext) => void | Promise<void>
  openSkills: (context?: SessionSlashCommandContext) => void | Promise<void>
  warpWorkspace: (context?: SessionSlashCommandContext) => void | Promise<void>
  openDiff: (context?: SessionSlashCommandContext) => void | Promise<void>
  shareSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  renameSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  openTimeline: (context?: SessionSlashCommandContext) => void | Promise<void>
  forkSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  compactSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  unshareSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  undoMessage: (context?: SessionSlashCommandContext) => void | Promise<void>
  redoMessage: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleTimestamps: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleThinking: (context?: SessionSlashCommandContext) => void | Promise<void>
  copyTranscript: (context?: SessionSlashCommandContext) => void | Promise<void>
  exportTranscript: (context?: SessionSlashCommandContext) => void | Promise<void>
}

export function buildSessionSlashCommands(input: {
  shared: boolean
  canRedo: boolean
  variantCount: number
  actions: SessionSlashCommandActions
}): SessionSlashCommand[] {
  return [
    {
      name: "sessions",
      title: "Switch session",
      detail: "Resume or continue an existing session",
      category: "Session",
      aliases: ["resume", "continue"],
      run: input.actions.switchSession,
    },
    {
      name: "new",
      title: "New session",
      detail: "Start a fresh chat",
      category: "Session",
      aliases: ["clear"],
      run: input.actions.createSession,
    },
    {
      name: "dashboard",
      title: "Open operations dashboard",
      detail: "Go to the OpencodeX dashboard",
      category: "OpencodeX",
      aliases: ["ops", "operations", "opencodex"],
      run: input.actions.openDashboard,
    },
    {
      name: "project",
      title: "Create project",
      detail: "Create an OpencodeX project",
      category: "OpencodeX",
      run: input.actions.createProject,
    },
    {
      name: "swarm-dash",
      title: "Show swarms",
      detail: "Open swarm dashboard entries",
      category: "Swarms",
      aliases: ["swarms", "swarm-list"],
      run: input.actions.openSwarms,
    },
    {
      name: "open-swarm",
      title: "Open swarm",
      detail: "Open the swarm management view",
      category: "Swarms",
      run: input.actions.openSwarm,
    },
    {
      name: "new-swarm",
      title: "Create swarm",
      detail: "Create a new swarm",
      category: "Swarms",
      run: input.actions.createSwarm,
    },
    {
      name: "swarm",
      title: "New swarm task",
      detail: "Assign work to an existing swarm",
      category: "Swarms",
      run: input.actions.createSwarmTask,
    },
    {
      name: "view",
      title: "Open view",
      detail: "Open the views page",
      category: "Views",
      aliases: ["views", "open-view"],
      run: input.actions.openView,
    },
    {
      name: "new-view",
      title: "Create view",
      detail: "Create a multi-session view",
      category: "Views",
      aliases: ["create-view"],
      run: input.actions.createView,
    },
    {
      name: "edit-view",
      title: "Edit view",
      detail: "Modify the active view",
      category: "Views",
      run: input.actions.editView,
    },
    {
      name: "delete-view",
      title: "Delete view",
      detail: "Remove the active view",
      category: "Views",
      run: input.actions.deleteView,
    },
    {
      name: "nsip",
      title: "New session in project",
      detail: "Create a session from a project folder",
      category: "OpencodeX",
      aliases: ["new-session-in-project"],
      run: input.actions.createProjectSession,
    },
    {
      name: "workspaces",
      title: "Manage workspaces",
      detail: "Switch or create workspaces",
      category: "Workspace",
      run: input.actions.manageWorkspaces,
    },
    {
      name: "models",
      title: "Switch model",
      detail: "Change the current composer model",
      category: "Agent",
      aliases: ["model"],
      run: input.actions.switchModel,
    },
    {
      name: "agents",
      title: "Switch agent",
      detail: "Change the current composer agent",
      category: "Agent",
      aliases: ["agent"],
      run: input.actions.switchAgent,
    },
    {
      name: "mcps",
      title: "Toggle MCPs",
      detail: "Enable or disable MCP servers",
      category: "Agent",
      aliases: ["mcp"],
      run: input.actions.toggleMcps,
    },
    {
      name: "variants",
      title: "Switch model variant",
      detail: "Choose a variant for the selected model",
      category: "Agent",
      aliases: ["variant"],
      disabled: input.variantCount === 0 ? "The selected model does not expose variants." : undefined,
      run: input.actions.switchVariant,
    },
    {
      name: "connect",
      title: "Connect provider",
      detail: "Add or configure model providers",
      category: "Provider",
      run: input.actions.connectProvider,
    },
    {
      name: "org",
      title: "Switch org",
      detail: "Change the active console organization",
      category: "Provider",
      aliases: ["orgs", "switch-org"],
      run: input.actions.switchOrg,
    },
    {
      name: "status",
      title: "View status",
      detail: "Open provider and runtime status",
      category: "System",
      run: input.actions.viewStatus,
    },
    {
      name: "themes",
      title: "Switch theme",
      detail: "Choose a TUI/GUI theme",
      category: "System",
      aliases: ["theme"],
      run: input.actions.switchTheme,
    },
    {
      name: "help",
      title: "Help",
      detail: "Show keyboard shortcuts and commands",
      category: "System",
      run: input.actions.showHelp,
    },
    {
      name: "exit",
      title: "Exit the app",
      detail: "Close OpencodeX",
      category: "System",
      aliases: ["quit", "q"],
      run: input.actions.exitApp,
    },
    {
      name: "editor",
      title: "Open editor",
      detail: "Edit the prompt in an external editor",
      category: "Prompt",
      run: input.actions.openEditor,
    },
    {
      name: "skills",
      title: "Skills",
      detail: "Insert or select a skill prompt",
      category: "Prompt",
      run: input.actions.openSkills,
    },
    {
      name: "warp",
      title: "Warp workspace",
      detail: "Change the workspace for this session",
      category: "Workspace",
      run: input.actions.warpWorkspace,
    },
    {
      name: "diff",
      title: "Open diff viewer",
      detail: "Inspect current session or git diffs",
      category: "VCS",
      run: input.actions.openDiff,
    },
    {
      name: "share",
      title: input.shared ? "Copy share link" : "Share session",
      detail: input.shared ? "Copy the existing share URL" : "Create a share URL",
      category: "Session",
      run: input.actions.shareSession,
    },
    {
      name: "rename",
      title: "Rename session",
      detail: "Change the current session title",
      category: "Session",
      run: input.actions.renameSession,
    },
    {
      name: "timeline",
      title: "Jump to message",
      detail: "Open the session timeline",
      category: "Session",
      run: input.actions.openTimeline,
    },
    {
      name: "fork",
      title: "Fork session",
      detail: "Create a new branch from a message",
      category: "Session",
      run: input.actions.forkSession,
    },
    {
      name: "compact",
      title: "Compact session",
      detail: "Summarize this session",
      category: "Session",
      aliases: ["summarize"],
      run: input.actions.compactSession,
    },
    {
      name: "unshare",
      title: "Unshare session",
      detail: "Disable the current share URL",
      category: "Session",
      disabled: input.shared ? undefined : "This session is not shared.",
      run: input.actions.unshareSession,
    },
    {
      name: "undo",
      title: "Undo previous message",
      detail: "Revert to the previous user turn",
      category: "Session",
      run: input.actions.undoMessage,
    },
    {
      name: "redo",
      title: "Redo",
      detail: "Restore the reverted turn",
      category: "Session",
      disabled: input.canRedo ? undefined : "No message to redo.",
      run: input.actions.redoMessage,
    },
    {
      name: "timestamps",
      title: "Toggle timestamps",
      detail: "Show or hide message timestamps",
      category: "Session",
      aliases: ["toggle-timestamps"],
      run: input.actions.toggleTimestamps,
    },
    {
      name: "thinking",
      title: "Toggle thinking",
      detail: "Expand or collapse reasoning blocks",
      category: "Session",
      aliases: ["toggle-thinking"],
      run: input.actions.toggleThinking,
    },
    {
      name: "copy",
      title: "Copy session transcript",
      detail: "Copy the rendered transcript",
      category: "Session",
      run: input.actions.copyTranscript,
    },
    {
      name: "export",
      title: "Export session transcript",
      detail: "Save the rendered transcript",
      category: "Session",
      run: input.actions.exportTranscript,
    },
  ]
}
