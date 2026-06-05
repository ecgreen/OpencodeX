import type { Session } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { deriveStatus, statusColor } from "./opencodex-session-status"
import { refreshOpencodeXSidebar } from "./opencodex-refresh"

type OpencodeXView = {
  id: string
  title?: string
  sessionIDs?: string[]
  timeUpdated?: number
}

type OpencodeXProjectInfo = {
  id: string
  name?: string
  project: {
    id: string
    name?: string
    worktree: string
  }
  folders?: { path: string }[]
  sessions: Session[]
}

type NewSessionSelection = {
  kind: "new"
  id: string
  projectID?: string
  projectLabel?: string
  directory?: string
}

type ViewSelection = { kind: "existing"; sessionID: string } | NewSessionSelection

type OpencodeXViewDialogContext = {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route?: ReturnType<typeof useRoute>
  view?: OpencodeXView
  title?: string
  sessionIDs?: string[]
  selection?: ViewSelection[]
  onCreated?: () => void
}

export async function createOpencodeXViewDialog(input: OpencodeXViewDialogContext) {
  input.dialog.replace(() => <OpencodeXViewSessionPicker {...input} />)
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}

export function selectOpencodeXViewDialog(input: Pick<OpencodeXViewDialogContext, "sdk" | "dialog" | "route">) {
  input.dialog.replace(() => <OpencodeXViewSelector {...input} mode="open" />)
}

export async function editOpencodeXViewDialog(input: Pick<OpencodeXViewDialogContext, "sdk" | "dialog" | "route">) {
  if (input.route?.data.type === "opencodex-view") {
    const view = await input.sdk
      .request<OpencodeXView>(`/experimental/opencodex/view/${input.route.data.viewID}`)
      .catch((error: Error) => {
        void DialogAlert.show(input.dialog, "Edit View", error.message)
      })
    if (!view) return
    await createOpencodeXViewDialog({ ...input, view })
    return
  }
  input.dialog.replace(() => <OpencodeXViewSelector {...input} mode="edit" />)
}

export function deleteOpencodeXViewDialog(input: Pick<OpencodeXViewDialogContext, "sdk" | "dialog" | "route">) {
  input.dialog.replace(() => <OpencodeXViewSelector {...input} mode="delete" />)
}

function OpencodeXViewSelector(
  props: Pick<OpencodeXViewDialogContext, "sdk" | "dialog" | "route"> & { mode: "open" | "edit" | "delete" },
) {
  const { theme } = useTheme()
  const [views] = createResource(() => props.sdk.request<OpencodeXView[]>("/experimental/opencodex/view"))
  const title = createMemo(() => {
    if (props.mode === "open") return "Open View"
    if (props.mode === "edit") return "Edit View"
    return "Delete View"
  })
  const verb = createMemo(() => {
    if (props.mode === "open") return "open"
    if (props.mode === "edit") return "edit"
    return "delete"
  })
  const options = createMemo(() =>
    (views() ?? []).map((view) => ({
      title: view.title ?? "Multi-session view",
      value: view.id,
      category: "Views",
      description: `${view.sessionIDs?.length ?? 0} session${view.sessionIDs?.length === 1 ? "" : "s"}`,
      gutter: () => <text fg={props.mode === "delete" ? theme.error : theme.primary}>{props.mode === "open" ? ">" : props.mode === "edit" ? "~" : "x"}</text>,
      onSelect: async () => {
        if (props.mode === "open") {
          props.dialog.clear()
          props.route?.navigate({ type: "opencodex-view", viewID: view.id })
          return
        }
        if (props.mode === "delete") {
          const confirmed = await DialogConfirm.show(props.dialog, "Delete view", `Delete "${view.title ?? "Multi-session view"}"?`, "keep")
          if (confirmed !== true) return
          const removed = await props.sdk
            .request<boolean>(`/experimental/opencodex/view/${view.id}`, { method: "DELETE" })
            .catch((error: Error) => {
              void DialogAlert.show(props.dialog, "Delete View", error.message)
            })
          if (!removed) return
          props.dialog.clear()
          if (props.route?.data.type === "opencodex-view" && props.route.data.viewID === view.id) {
            props.route.navigate({ type: "opencodex-dashboard" })
          }
          refreshOpencodeXSidebar()
          return
        }
        void createOpencodeXViewDialog({ ...props, view })
      },
    })),
  )

  onMount(() => {
    props.dialog.setSize("medium")
  })

  return (
    <DialogSelect
      title={title()}
      placeholder="Search views"
      options={options()}
      footerHints={[{ title: verb(), label: "enter" }]}
    />
  )
}

function OpencodeXViewSessionPicker(props: OpencodeXViewDialogContext) {
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()
  const [title, setTitle] = createSignal(props.title ?? props.view?.title ?? "")
  const [selection, setSelection] = createSignal<ViewSelection[]>(
    (
      props.selection
        ?? [...(props.sessionIDs ?? props.view?.sessionIDs ?? [])].map((sessionID): ViewSelection => ({
          kind: "existing",
          sessionID,
        }))
    ).slice(0, 8),
  )
  const [projects] = createResource(() => props.sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project"))
  const selectedSessionIDs = createMemo(() =>
    selection()
      .filter((item): item is { kind: "existing"; sessionID: string } => item.kind === "existing")
      .map((item) => item.sessionID),
  )
  const selectedNewSessions = createMemo(() =>
    selection().filter((item): item is NewSessionSelection => item.kind === "new"),
  )
  const selectedCount = createMemo(() => selection().length)
  const remainingCount = createMemo(() => Math.max(0, 8 - selectedCount()))
  const selectedSet = createMemo(() => new Set(selectedSessionIDs()))
  const sessionMap = createMemo(
    () => new Map(sync.data.session.filter((session) => !session.parentID).map((session) => [session.id, session])),
  )
  const mappedSessionIDs = createMemo(
    () => new Set((projects() ?? []).flatMap((project) => project.sessions.map((session) => session.id))),
  )
  const projectSessionEntries = createMemo(() =>
    (projects() ?? []).flatMap((project) =>
      project.sessions
        .map((session) => sessionMap().get(session.id) ?? session)
        .toSorted((a, b) => b.time.updated - a.time.updated)
        .map((session) => ({ session, project: projectLabel(project) })),
    ),
  )
  const projectLabelBySessionID = createMemo(
    () => new Map(projectSessionEntries().map((entry) => [entry.session.id, entry.project] as const)),
  )
  const modalSessionByID = createMemo(
    () =>
      new Map([
        ...projectSessionEntries().map((entry) => [entry.session.id, entry.session] as const),
        ...[...sessionMap().values()].map((session) => [session.id, session] as const),
      ]),
  )
  const unassigned = createMemo(() =>
    [...sessionMap().values()]
      .filter((session) => !mappedSessionIDs().has(session.id))
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const pinned = createMemo(() =>
    local.session
      .pinned()
      .map((sessionID) => modalSessionByID().get(sessionID))
      .filter((session): session is Session => session !== undefined),
  )
  const pinnedIDs = createMemo(() => new Set(pinned().map((session) => session.id)))
  const selectedSessions = createMemo(() =>
    selectedSessionIDs()
      .map((sessionID) => modalSessionByID().get(sessionID))
      .filter((session): session is Session => session !== undefined),
  )

  function projectLabel(project: OpencodeXProjectInfo) {
    return project.name ?? project.project.name ?? project.project.worktree
  }

  function buildOption(session: Session, category: string, footer?: string) {
    const checked = selectedSet().has(session.id)
    return {
      title: session.title,
      value: session.id,
      category,
      footer: footer ?? (local.session.isPinned(session.id) ? "pinned" : ""),
      gutter: () => <text fg={checked ? theme.primary : statusColor(deriveStatus(session.id, sync))}>{checked ? "[x]" : "*"}</text>,
      onSelect: () => void toggle(session.id),
    }
  }

  function buildNewSessionOption(slot: NewSessionSelection, index: number) {
    return {
      title: `New session ${index + 1}${slot.projectLabel ? ` in ${slot.projectLabel}` : ""}`,
      value: slot.id,
      category: "New Sessions",
      description: slot.directory ?? "No project",
      footer: "pending",
      gutter: () => <text fg={theme.primary}>[x]</text>,
      onSelect: () => setSelection((current) => current.filter((item) => item.kind !== "new" || item.id !== slot.id)),
    }
  }

  const options = createMemo(() => [
    ...selectedNewSessions().map(buildNewSessionOption),
    ...pinned().map((session) => buildOption(session, "Pinned", projectLabelBySessionID().get(session.id))),
    ...projectSessionEntries()
      .filter((entry) => !pinnedIDs().has(entry.session.id))
      .map((entry) => buildOption(entry.session, entry.project)),
    ...unassigned()
      .filter((session) => !pinnedIDs().has(session.id))
      .map((session) => buildOption(session, "Sessions")),
    {
      title: "Add new sessions",
      category: "Action",
      value: "add-new-sessions",
      description: remainingCount() === 0 ? "View is full" : "Create blank sessions when saving",
      gutter: () => <text fg={remainingCount() === 0 ? theme.textMuted : theme.primary}>+</text>,
      onSelect: () => void addNewSessions(),
    },
    {
      title: "Rename view",
      category: "Action",
      value: "rename",
      description: title() || "Untitled view",
      gutter: () => <text fg={theme.primary}>~</text>,
      onSelect: () => void renameView(),
    },
    {
      title: selectedCount() === 0
        ? props.view ? "Select sessions before saving" : "Select sessions before creating"
        : props.view ? "Save changes" : "Create view",
      value: "save",
      category: "Action",
      description: `${selectedCount()} selected`,
      gutter: () => <text fg={selectedCount() === 0 ? theme.textMuted : theme.primary}>{">"}</text>,
      onSelect: () => void saveView(),
    },
  ])

  onMount(() => {
    props.dialog.setSize("large")
  })

  function reopenPicker() {
    props.dialog.replace(() => <OpencodeXViewSessionPicker {...props} title={title()} selection={selection()} />)
  }

  async function toggle(sessionID: string) {
    if (selectedSet().has(sessionID)) {
      setSelection((current) => current.filter((item) => item.kind !== "existing" || item.sessionID !== sessionID))
      return
    }
    if (selectedCount() >= 8) {
      await DialogAlert.show(props.dialog, props.view ? "Edit View" : "Create View", "A view can include at most eight sessions.")
      reopenPicker()
      return
    }
    setSelection((current) => [...current, { kind: "existing", sessionID }])
  }

  async function addNewSessions() {
    const available = remainingCount()
    if (available === 0) {
      await DialogAlert.show(props.dialog, props.view ? "Edit View" : "Create View", "A view can include at most eight sessions.")
      reopenPicker()
      return
    }
    let list = projects()
    if (!list) {
      list = await props.sdk
        .request<OpencodeXProjectInfo[]>("/experimental/opencodex/project")
        .catch(async (error: Error) => {
          await DialogAlert.show(props.dialog, props.view ? "Edit View" : "Create View", error.message)
          reopenPicker()
          return undefined
        })
    }
    if (!list) return
    props.dialog.replace(() => (
      <DialogSelect
        title="New sessions destination"
        placeholder="Search destinations"
        options={[
          {
            title: "No Project",
            value: "none",
            description: "Standalone sessions",
            gutter: () => <text fg={theme.primary}>+</text>,
            onSelect: () => void promptNewSessionCount({}, available),
          },
          ...list.map((project) => ({
            title: projectLabel(project),
            value: project.id,
            description: `${project.sessions.length} session${project.sessions.length === 1 ? "" : "s"}`,
            gutter: () => <text fg={theme.primary}>+</text>,
            onSelect: () => void promptNewSessionCount(
              {
                projectID: project.id,
                projectLabel: projectLabel(project),
                directory: project.folders?.[0]?.path ?? project.project.worktree,
              },
              available,
            ),
          })),
        ]}
        footerHints={[{ title: "select", label: "enter" }]}
      />
    ))
  }

  async function promptNewSessionCount(destination: Omit<NewSessionSelection, "kind" | "id">, max: number) {
    const value = await DialogPrompt.show(props.dialog, "New sessions", {
      placeholder: `How many? 1-${max}`,
      value: String(Math.min(4, max)),
    })
    if (value === null) {
      reopenPicker()
      return
    }
    const count = Number.parseInt(value.trim(), 10)
    if (!Number.isInteger(count) || count < 1 || count > max) {
      await DialogAlert.show(props.dialog, "New sessions", `Enter a number from 1 to ${max}.`)
      reopenPicker()
      return
    }
    const stamp = Date.now()
    setSelection((current) => [
      ...current,
      ...Array.from({ length: count }, (_, index): NewSessionSelection => ({
        kind: "new",
        id: `new:${destination.projectID ?? "none"}:${stamp}:${index}`,
        ...destination,
      })),
    ])
    reopenPicker()
  }

  async function renameView() {
    const next = await DialogPrompt.show(props.dialog, "View name", {
      placeholder: "View name",
      value: title(),
    })
    if (next === null) {
      reopenPicker()
      return
    }
    setTitle(next.trim())
    props.dialog.replace(() => <OpencodeXViewSessionPicker {...props} title={next.trim()} selection={selection()} />)
  }

  async function createSessionForSlot(slot: NewSessionSelection) {
    if (slot.projectID) {
      return await props.sdk.request<Session>("/experimental/opencodex/session", {
        method: "POST",
        body: JSON.stringify({
          projectID: slot.projectID,
          directory: slot.directory,
        }),
      })
    }
    const result = await props.sdk.client.session.create({})
    if (result.error || !result.data) throw new Error(errorText(result.error ?? "no response"))
    return result.data
  }

  async function saveView() {
    if (selectedCount() === 0) {
      await DialogAlert.show(props.dialog, props.view ? "Edit View" : "Create View", "Select at least one session.")
      reopenPicker()
      return
    }
    const currentSelection = selection()
    const resolvedSelection: ViewSelection[] = []
    for (let index = 0; index < currentSelection.length; index++) {
      const item = currentSelection[index]
      if (!item) continue
      if (item.kind === "existing") {
        resolvedSelection.push(item)
        continue
      }
      const session = await createSessionForSlot(item).catch(async (error: Error) => {
        await DialogAlert.show(props.dialog, props.view ? "Edit View" : "Create View", error.message)
        setSelection([...resolvedSelection, ...currentSelection.slice(index)])
        reopenPicker()
      })
      if (!session) return
      resolvedSelection.push({ kind: "existing", sessionID: session.id })
    }
    setSelection(resolvedSelection)
    const sessionIDs = resolvedSelection
      .filter((item): item is { kind: "existing"; sessionID: string } => item.kind === "existing")
      .map((item) => item.sessionID)
    const first = selectedSessions()[0]
    const viewTitle = title() || (first && sessionIDs.length === 1 ? first.title : `${sessionIDs.length} session view`)
    const view = await props.sdk
      .request<OpencodeXView>(props.view ? `/experimental/opencodex/view/${props.view.id}` : "/experimental/opencodex/view", {
        method: props.view ? "PATCH" : "POST",
        body: JSON.stringify({
          title: viewTitle,
          sessionIDs,
        }),
      })
      .catch(async (error: Error) => {
        await DialogAlert.show(props.dialog, props.view ? "Edit View" : "Create View", error.message)
        reopenPicker()
      })
    if (!view) return
    props.dialog.clear()
    refreshOpencodeXSidebar()
    props.onCreated?.()
    props.route?.navigate({ type: "opencodex-view", viewID: view.id })
  }

  return (
    <DialogSelect
      title={`${props.view ? "Edit View" : "Select Sessions"} (${selectedCount()}/8)`}
      placeholder="Search sessions"
      options={options()}
      footerHints={[
        { title: "toggle", label: "enter" },
        { title: props.view ? "save" : "create", label: "ctrl+enter" },
        { title: props.view ? "save" : "create", label: props.view ? "select Save changes" : "select Create view", side: "right" },
      ]}
      bindings={[{ key: "ctrl+return", desc: props.view ? "Save view" : "Create view", group: "Dialog", cmd: () => void saveView() }]}
    />
  )
}
