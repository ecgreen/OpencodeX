import type { GuiSnapshot } from "./session-api"

type ConfirmDialogInput = { title: string; message: string; confirm?: string }
type ProjectDialogInput = { title: string; message?: string; name: string; folders: string[] }
type ProjectDialogValue = { name: string; folders: string[] }

export type ProjectFolderValidation = {
  data?: {
    valid: boolean
    folders: Array<{ input: string; message?: string }>
  }
}

export function projectNameFromDirectory(directory: string) {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "New Project"
}

export function projectFoldersFromText(input: string) {
  return input.split(/\r?\n/).map((folder) => folder.trim()).filter(Boolean)
}

export function projectFolderValidationMessage(validation: ProjectFolderValidation) {
  if (!validation.data || validation.data.valid) return
  const messages = validation.data.folders.map((folder) => folder.message ?? `${folder.input} is invalid`)
  return messages.length > 0 ? messages.join("\n") : "Project folder validation failed."
}

export function newSessionDirectory(input: {
  directory?: string
  projects: GuiSnapshot["projects"]
  guiDirectory: string
}) {
  return (input.directory ?? input.projects[0]?.folders[0]?.path ?? input.guiDirectory) || undefined
}

/**
 * Folders first, then a name step seeded from the folder they picked. The name
 * used to be derived silently, so the only way to correct it was to edit the
 * project you had just made.
 */
export async function runCreateProjectAction(input: {
  fallbackDirectory: string
  chooseFolders: (fallback: string) => Promise<string[] | undefined>
  askProject: (input: ProjectDialogInput) => Promise<ProjectDialogValue | undefined>
  validateProjectFolders: (folders: string[]) => Promise<ProjectFolderValidation>
  createProject: (name: string, directory: string, folders: string[]) => Promise<void>
  refresh: () => Promise<void>
  alert: (message: string) => void
  succeed?: (message: string) => void
}) {
  const picked = uniqueFolders(await input.chooseFolders(input.fallbackDirectory || ".") ?? [])
  if (picked.length === 0) return
  const next = await input.askProject({
    title: "Create project",
    message: "Name the project and confirm the folders its sessions will run in.",
    name: projectNameFromDirectory(picked[0]),
    folders: picked,
  })
  if (!next) return
  const folders = uniqueFolders(next.folders)
  const directory = folders[0]
  if (!directory) return input.alert("A project needs at least one folder.")
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders(folders))
  if (validationMessage) return input.alert(validationMessage)
  await input.createProject(next.name.trim() || projectNameFromDirectory(directory), directory, folders)
  await input.refresh()
  input.succeed?.(`Created ${next.name.trim() || projectNameFromDirectory(directory)}.`)
}

export async function runEditProjectAction(input: {
  projectID: string
  currentName?: string
  folders: string[]
  askProject: (input: ProjectDialogInput) => Promise<ProjectDialogValue | undefined>
  validateProjectFolders: (projectID: string, folders: string[]) => Promise<ProjectFolderValidation>
  updateProject: (projectID: string, next: { name: string; folders: string[] }) => Promise<void>
  refresh: () => Promise<void>
  alert: (message: string) => void
  succeed?: (message: string) => void
}) {
  const next = await input.askProject({
    title: "Edit project",
    message: "Update the project name and the workspace folders its sessions, views, and workbench actions run in.",
    name: input.currentName ?? "",
    folders: input.folders,
  })
  if (!next) return
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders(input.projectID, next.folders))
  if (validationMessage) return input.alert(validationMessage)
  await input.updateProject(input.projectID, next)
  await input.refresh()
  input.succeed?.(`Updated ${next.name.trim() || input.currentName || "project"}.`)
}

function uniqueFolders(folders: string[]) {
  return [...new Set(folders.map((folder) => folder.trim()).filter(Boolean))]
}

export async function runDeleteProjectAction(input: {
  projectID: string
  name: string
  /** What the grouping currently holds, so the confirm can say what is at stake. */
  sessionCount?: number
  terminalSessionCount?: number
  confirm: (input: ConfirmDialogInput) => Promise<boolean>
  deleteProject: (projectID: string) => Promise<void>
  refresh: () => Promise<void>
  succeed?: (message: string) => void
}) {
  if (!(await input.confirm({
    title: "Delete Project",
    message: deleteProjectMessage(input.name, input.sessionCount ?? 0, input.terminalSessionCount ?? 0),
    confirm: "Delete",
  }))) return
  await input.deleteProject(input.projectID)
  await input.refresh()
  input.succeed?.(`Deleted ${input.name}.`)
}

export function deleteProjectMessage(name: string, sessionCount: number, terminalSessionCount: number) {
  const holdings = [
    sessionCount > 0 ? `${sessionCount} ${sessionCount === 1 ? "session" : "sessions"}` : "",
    terminalSessionCount > 0 ? `${terminalSessionCount} Claude Code ${terminalSessionCount === 1 ? "session" : "sessions"}` : "",
  ].filter(Boolean)
  return [
    `Delete the OpencodeX project "${name}"?`,
    "",
    holdings.length > 0
      ? `${holdings.join(" and ")} leave this grouping. The conversations themselves are kept and stay reachable from Sessions.`
      : "This removes the GUI/TUI project grouping.",
  ].join("\n")
}

export function runCreateSessionRouteAction(input: {
  projectID?: string
  directory?: string
  projects: GuiSnapshot["projects"]
  guiDirectory: string
  setPrompt: (value: string) => void
  openNewSession: (projectID: string | undefined, directory: string) => void
  focusComposer: () => void
}) {
  const directory = newSessionDirectory({
    directory: input.directory,
    projects: input.projects,
    guiDirectory: input.guiDirectory,
  })
  if (!directory) return
  input.setPrompt("")
  input.openNewSession(input.projectID, directory)
  input.focusComposer()
  return { projectID: input.projectID, directory }
}
