import type { PromptPart } from "./store"

export type SessionSlashCommandContext = {
  draftPrompt: string
  draftParts?: PromptPart[]
  setDraftPrompt: (value: string) => void
  setDraftParts?: (value: PromptPart[]) => void
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
  useSwarm: (context?: SessionSlashCommandContext) => void | Promise<void>
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
  forkSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  compactSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  unshareSession: (context?: SessionSlashCommandContext) => void | Promise<void>
  undoMessage: (context?: SessionSlashCommandContext) => void | Promise<void>
  redoMessage: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleCodeConceal: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleTimestamps: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleThinking: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleToolDetails: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleScrollbar: (context?: SessionSlashCommandContext) => void | Promise<void>
  toggleGenericToolOutput: (context?: SessionSlashCommandContext) => void | Promise<void>
  copyTranscript: (context?: SessionSlashCommandContext) => void | Promise<void>
  exportTranscript: (context?: SessionSlashCommandContext) => void | Promise<void>
}
