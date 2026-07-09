import type { GuiSnapshot } from "./store"

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

export async function runCreateProjectAction(input: {
  fallbackDirectory: string
  chooseFolders: (fallback: string) => Promise<string[] | undefined>
  validateProjectFolders: (folders: string[]) => Promise<ProjectFolderValidation>
  createProject: (name: string, directory: string, folders: string[]) => Promise<void>
  refresh: () => Promise<void>
  alert: (message: string) => void
}) {
  const folders = uniqueFolders(await input.chooseFolders(input.fallbackDirectory || ".") ?? [])
  const directory = folders[0]
  if (!directory) return
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders(folders))
  if (validationMessage) return input.alert(validationMessage)
  await input.createProject(projectNameFromDirectory(directory), directory, folders)
  await input.refresh()
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
}) {
  const next = await input.askProject({
    title: "Edit project",
    message: "Update the project name and the workspace folders used for sessions, views, swarms, and workbench actions.",
    name: input.currentName ?? "",
    folders: input.folders,
  })
  if (!next) return
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders(input.projectID, next.folders))
  if (validationMessage) return input.alert(validationMessage)
  await input.updateProject(input.projectID, next)
  await input.refresh()
}

function uniqueFolders(folders: string[]) {
  return [...new Set(folders.map((folder) => folder.trim()).filter(Boolean))]
}

export async function runDeleteProjectAction(input: {
  projectID: string
  name: string
  confirm: (input: ConfirmDialogInput) => Promise<boolean>
  deleteProject: (projectID: string) => Promise<void>
  refresh: () => Promise<void>
}) {
  if (!(await input.confirm({ title: "Delete Project", message: `Delete OpencodeX project grouping "${input.name}"?\n\nThis removes the GUI/TUI project grouping.`, confirm: "Delete" }))) return
  await input.deleteProject(input.projectID)
  await input.refresh()
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
