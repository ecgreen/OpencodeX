import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogFolderPicker } from "@tui/ui/dialog-folder-picker"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { refreshOpencodeXSidebar } from "./opencodex-refresh"
import { projectTitle } from "./opencodex-sidebar-model"
import type { OpencodeXDialogContext, OpencodeXProjectInfo, OpencodeXProjectValidation } from "./opencodex-sidebar-types"
import { deriveStatus } from "./opencodex-session-status"

async function confirmValidFolders(input: OpencodeXDialogContext & { folders: string[]; projectID?: string }) {
  const validation = await input.sdk.request<OpencodeXProjectValidation>("/experimental/opencodex/project/validate", {
    method: "POST",
    body: JSON.stringify({ projectID: input.projectID, folders: input.folders }),
  }).catch((error: Error) => void DialogAlert.show(input.dialog, "Folder Validation", error.message))
  if (!validation) return false
  if (!validation.valid) {
    await DialogAlert.show(input.dialog, "Folder Validation", validation.folders.length === 0 ? "No folders configured." : validation.folders.filter((folder) => !folder.valid).map((folder) => folder.message ?? `Invalid folder: ${folder.path}`).slice(0, 4).join("\n"))
    return false
  }
  return await DialogConfirm.show(input.dialog, "Use Project Folders", validation.folders.length === 0 ? "No folders configured." : validation.folders.map((folder) => folder.path).join("\n")) === true
}

export async function createOpencodeXProjectDialog(input: OpencodeXDialogContext) {
  const name = await DialogPrompt.show(input.dialog, "Project name", { placeholder: "Optional display name" })
  if (name === null) return
  const folders = await DialogFolderPicker.show(input.dialog, "Project folders", { initialDirectory: input.sdk.directory ?? process.cwd() })
  if (folders === null || !(await confirmValidFolders({ ...input, folders }))) return
  await input.sdk.request<OpencodeXProjectInfo>("/experimental/opencodex/project", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() || undefined, folders, directory: input.sdk.directory }),
  }).then(() => {
    input.refetch?.()
    refreshOpencodeXSidebar()
  }).catch((error: Error) => DialogAlert.show(input.dialog, "Project Error", error.message))
}

export function manageOpencodeXProjectsDialog(input: OpencodeXDialogContext) {
  input.dialog.replace(() => <OpencodeXProjectManager />)
}

function OpencodeXProjectManager() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = createSignal<string>()
  const [currentProjectID, setCurrentProjectID] = createSignal<string>()
  const [refresh, setRefresh] = createSignal(0)
  const [projects, { refetch }] = createResource(refresh, () => sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project"))
  const sessionIDs = createMemo(() => new Set(sync.data.session.filter((session) => !session.parentID).map((session) => session.id)))
  const list = () => {
    setRefresh((value) => value + 1)
    void refetch()
    refreshOpencodeXSidebar()
  }
  const options = createMemo(() => (projects() ?? []).map((project) => {
    const count = project.sessions.filter((session) => sessionIDs().has(session.id)).length
    const deleting = toDelete() === project.id
    return {
      title: deleting ? "Press delete again to confirm" : projectTitle(project),
      value: project.id,
      description: `${project.folders.length} folder${project.folders.length !== 1 ? "s" : ""}, ${count} conversation${count !== 1 ? "s" : ""}${project.sessions.some((session) => deriveStatus(session.id, sync) !== "dormant") ? ", active" : ""}`,
      bg: deleting ? theme.error : undefined,
      footer: project.folders[0]?.path ?? "",
    }
  }))

  async function deleteProject(projectID: string) {
    const removed = await sdk.request<boolean>(`/experimental/opencodex/project/${projectID}`, { method: "DELETE" }).catch((error: Error) => void DialogAlert.show(dialog, "Delete Project", error.message))
    if (!removed) return
    setToDelete(undefined)
    setCurrentProjectID(undefined)
    list()
  }

  async function renameProject(projectID: string) {
    const project = (projects() ?? []).find((item) => item.id === projectID)
    if (!project) return
    const name = await DialogPrompt.show(dialog, "Project name", { placeholder: "Optional display name", value: project.name ?? "" })
    if (name === null) return void dialog.replace(() => <OpencodeXProjectManager />)
    await sdk.request<OpencodeXProjectInfo>(`/experimental/opencodex/project/${projectID}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }).then(() => {
      setCurrentProjectID(projectID)
      list()
      dialog.replace(() => <OpencodeXProjectManager />)
    }).catch((error: Error) => DialogAlert.show(dialog, "Rename Project", error.message))
  }

  async function editProjectFolders(projectID: string) {
    const project = (projects() ?? []).find((item) => item.id === projectID)
    if (!project) return
    const folders = await DialogFolderPicker.show(dialog, "Project folders", { initialDirectory: project.folders[0]?.path ?? sdk.directory ?? project.project.worktree, selected: project.folders.map((folder) => folder.path) })
    if (folders === null) return void dialog.replace(() => <OpencodeXProjectManager />)
    if (!(await confirmValidFolders({ sdk, dialog, theme, folders, projectID }))) return
    await sdk.request<OpencodeXProjectInfo>(`/experimental/opencodex/project/${projectID}`, { method: "PATCH", body: JSON.stringify({ folders }) }).then(() => {
      setCurrentProjectID(projectID)
      list()
      dialog.replace(() => <OpencodeXProjectManager />)
    }).catch((error: Error) => DialogAlert.show(dialog, "Project Folders", error.message))
  }

  async function reorderProject(projectID: string, offset: number) {
    const ids = (projects() ?? []).map((project) => project.id)
    const index = ids.indexOf(projectID)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
    const next = ids.map((id, itemIndex) => itemIndex === index ? ids[nextIndex] : itemIndex === nextIndex ? ids[index] : id)
    await sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project/reorder", { method: "POST", body: JSON.stringify({ projectIDs: next }) }).then(() => {
      setCurrentProjectID(projectID)
      setToDelete(undefined)
      list()
    }).catch((error: Error) => DialogAlert.show(dialog, "Reorder Projects", error.message))
  }

  onMount(() => dialog.setSize("large"))
  return (
    <DialogSelect
      title="Manage Projects"
      options={options()}
      current={currentProjectID()}
      onMove={(option) => { setCurrentProjectID(option.value); setToDelete(undefined) }}
      actions={[
        { command: "session.delete", title: "delete", onTrigger: (option) => toDelete() === option.value ? void deleteProject(option.value) : setToDelete(option.value) },
        { command: "session.rename", title: "rename", onTrigger: (option) => void renameProject(option.value) },
        { command: "opencodex.project.folders", title: "folders", onTrigger: (option) => void editProjectFolders(option.value) },
        { command: "opencodex.project.move_up", title: "up", disabled: (projects() ?? []).length < 2, onTrigger: (option) => void reorderProject(option.value, -1) },
        { command: "opencodex.project.move_down", title: "down", disabled: (projects() ?? []).length < 2, onTrigger: (option) => void reorderProject(option.value, 1) },
      ]}
    />
  )
}
