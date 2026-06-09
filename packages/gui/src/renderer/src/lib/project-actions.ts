import type { GuiSnapshot } from "./store"

type TextDialogInput = { title: string; message?: string; value?: string; multiline?: boolean }
type ConfirmDialogInput = { title: string; message: string; confirm?: string }

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
  chooseFolder: (fallback: string) => Promise<string | undefined>
  validateProjectFolders: (folders: string[]) => Promise<ProjectFolderValidation>
  createProject: (name: string, directory: string) => Promise<void>
  refresh: () => Promise<void>
  alert: (message: string) => void
}) {
  const directory = await input.chooseFolder(input.fallbackDirectory || ".")
  if (!directory) return
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders([directory]))
  if (validationMessage) return input.alert(validationMessage)
  await input.createProject(projectNameFromDirectory(directory), directory)
  await input.refresh()
}

export async function runRenameProjectAction(input: {
  projectID: string
  current?: string
  askText: (input: TextDialogInput) => Promise<string | undefined>
  renameProject: (projectID: string, name: string) => Promise<void>
  refresh: () => Promise<void>
}) {
  const name = (await input.askText({ title: "Rename Project", value: input.current ?? "" }))?.trim()
  if (!name) return
  await input.renameProject(input.projectID, name)
  await input.refresh()
}

export async function runEditProjectFoldersAction(input: {
  projectID: string
  folders: string[]
  askText: (input: TextDialogInput) => Promise<string | undefined>
  validateProjectFolders: (projectID: string, folders: string[]) => Promise<ProjectFolderValidation>
  updateProjectFolders: (projectID: string, folders: string[]) => Promise<void>
  refresh: () => Promise<void>
  alert: (message: string) => void
}) {
  const text = await input.askText({ title: "Project Folders", message: "One folder per line", value: input.folders.join("\n"), multiline: true })
  if (!text) return
  const folders = projectFoldersFromText(text)
  if (folders.length === 0) return
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders(input.projectID, folders))
  if (validationMessage) return input.alert(validationMessage)
  await input.updateProjectFolders(input.projectID, folders)
  await input.refresh()
}

export async function runEditProjectAction(input: {
  projectID: string
  currentName?: string
  folders: string[]
  askText: (input: TextDialogInput) => Promise<string | undefined>
  validateProjectFolders: (projectID: string, folders: string[]) => Promise<ProjectFolderValidation>
  updateProject: (projectID: string, next: { name: string; folders: string[] }) => Promise<void>
  refresh: () => Promise<void>
  alert: (message: string) => void
}) {
  const name = (await input.askText({ title: "Edit Project Name", value: input.currentName ?? "" }))?.trim()
  if (!name) return
  const text = await input.askText({ title: "Edit Project Folders", message: "One folder per line", value: input.folders.join("\n"), multiline: true })
  if (!text) return
  const folders = projectFoldersFromText(text)
  if (folders.length === 0) return
  const validationMessage = projectFolderValidationMessage(await input.validateProjectFolders(input.projectID, folders))
  if (validationMessage) return input.alert(validationMessage)
  await input.updateProject(input.projectID, { name, folders })
  await input.refresh()
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
}
