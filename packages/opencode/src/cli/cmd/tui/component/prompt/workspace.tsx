import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "../../ui/toast"
import { errorMessage } from "@/util/error"
import {
  confirmWorkspaceFileChanges,
  openWorkspaceSelect,
  warpWorkspaceSession,
  type WorkspaceSelection,
} from "../dialog-workspace-create"
import type { WorkspaceStatus } from "../workspace-label"

export function createPromptWorkspaceController(input: { sessionID: () => string | undefined }) {
  const dialog = useDialog()
  const project = useProject()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [selection, setSelection] = createSignal<WorkspaceSelection>()
  const [creating, setCreating] = createSignal(false)
  const [creatingDots, setCreatingDots] = createSignal(3)
  const [notice, setNotice] = createSignal<string>()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined

  async function create(selection: Extract<WorkspaceSelection, { type: "new" }>) {
    setCreating(true)
    const result = await sdk.client.experimental.workspace
      .create({ type: selection.workspaceType, branch: null })
      .then((value) => ({ value, error: undefined }))
      .catch((error: Error) => ({ value: undefined, error }))
    if (result.error || result.value?.error || !result.value?.data) {
      setSelection(undefined)
      setCreating(false)
      toast.show({
        title: "Creating workspace failed",
        message: errorMessage(result.error ?? result.value?.error ?? "no response"),
        variant: "error",
      })
      return
    }

    await project.workspace.sync()
    const workspace = result.value.data
    setSelection({
      type: "existing",
      workspaceID: workspace.id,
      workspaceType: workspace.type,
      workspaceName: workspace.name,
    })
    setCreating(false)
    return workspace
  }

  async function warp(next: WorkspaceSelection) {
    const sessionID = input.sessionID()
    if (!sessionID) {
      setSelection(next)
      dialog.clear()
      if (next.type === "new") void create(next)
      return
    }
    const sourceWorkspaceID = project.workspace.current()
    const copyChanges = await confirmWorkspaceFileChanges({ dialog, sdk, sourceWorkspaceID })
    if (copyChanges === undefined) return
    setSelection(next)
    dialog.clear()

    const workspace =
      next.type === "none"
        ? { id: null, name: "local project" }
        : next.type === "existing"
          ? { id: next.workspaceID, name: next.workspaceName }
          : await create(next)
    if (!workspace) return
    const warped = await warpWorkspaceSession({
      dialog,
      sdk,
      sync,
      project,
      toast,
      sourceWorkspaceID,
      workspaceID: workspace.id,
      sessionID,
      copyChanges,
    })
    if (!warped) return
    setNotice(`Warped to ${workspace.name}`)
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => setNotice(undefined), 4000)
  }

  function open() {
    return openWorkspaceSelect({
      dialog,
      sdk,
      sync,
      project,
      toast,
      onSelect: (next) => void warp(next),
    })
  }

  createEffect(() => {
    if (!creating()) {
      setCreatingDots(3)
      return
    }
    const timer = setInterval(() => setCreatingDots((dots) => (dots % 3) + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })
  onCleanup(() => {
    if (noticeTimer) clearTimeout(noticeTimer)
  })

  const label = createMemo<
    | { type: "new"; workspaceType: string }
    | { type: "existing"; workspaceType: string; workspaceName: string; status?: WorkspaceStatus }
    | undefined
  >(() => {
    const selected = selection()
    if (!selected || selected.type === "none") return
    if (input.sessionID() && !creating()) return
    if (selected.type === "new") return { type: "new", workspaceType: selected.workspaceType }
    return {
      type: "existing",
      workspaceType: selected.workspaceType,
      workspaceName: selected.workspaceName,
      status: "connected",
    }
  })

  return {
    selection,
    setSelection,
    creating,
    creatingDots,
    notice,
    clearNotice: () => setNotice(undefined),
    label,
    create,
    warp,
    open,
  }
}
