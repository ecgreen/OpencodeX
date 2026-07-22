import { TextAttributes } from "@opentui/core"
import type { Session } from "@opencode-ai/sdk/v2"
import { clientSessionOrderBucketForStatus } from "@opencode-ai/sdk/v2/session-order"
import { DialogSessionRename } from "@tui/component/dialog-session-rename"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createSignal, onMount, type JSX } from "solid-js"
import { refreshOpencodeXSidebar } from "./opencodex-refresh"
import { isSwarmSession } from "./opencodex-sidebar-model"
import type { OpencodeXDialogContext, OpencodeXProjectInfo, OpencodeXViewInfo, SessionManagerOptionValue } from "./opencodex-sidebar-types"
import { getPendingOpencodeXProjectSession, setPendingOpencodeXProjectSession } from "./opencodex-session-state"
import { isRecentSessionUpdate } from "./opencodex-session-recency"
import { deriveStatus, statusColor } from "./opencodex-session-status"

export async function createOpencodeXProjectSession(input: OpencodeXDialogContext & { project: OpencodeXProjectInfo }) {
  const directory = input.sdk.directory ?? input.project.project.worktree
  const existing = input.sync?.data.session.find((session) => !session.parentID && !session.model && session.title.startsWith("New session - ") && input.project.sessionIDs.includes(session.id))
  if (existing) {
    if (input.route?.data.type !== "session" || input.route.data.sessionID !== existing.id) input.route?.navigate({ type: "session", sessionID: existing.id })
    return
  }
  const pending = getPendingOpencodeXProjectSession()
  if (pending?.projectID === input.project.id) {
    if (input.route?.data.type !== "home") input.route?.navigate({ type: "home" })
    return
  }
  setPendingOpencodeXProjectSession({ projectID: input.project.id, directory })
  input.route?.navigate({ type: "home" })
  input.refetch?.()
  refreshOpencodeXSidebar()
}

export async function newOpencodeXSessionInProjectDialog(input: OpencodeXDialogContext) {
  const projects = input.sync?.data.opencodex_project ?? await input.sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project").then((items) => items.map((project) => ({ ...project, sessionIDs: project.sessions.map((session) => session.id) }))).catch((error: Error) => void DialogAlert.show(input.dialog, "New Session in Project", error.message))
  if (!projects) return
  if (projects.length === 0) return void await DialogAlert.show(input.dialog, "New Session in Project", "Create a project before starting project sessions.")
  const sessionIDs = new Set(input.sync?.data.session.filter((session) => !session.parentID).map((session) => session.id) ?? [])
  input.dialog.replace(() => (
    <DialogSelect
      title="New session in project"
      options={projects.map((project) => {
        const count = input.sync ? project.sessionIDs.filter((sessionID) => sessionIDs.has(sessionID)).length : project.sessionIDs.length
        return { title: project.name ?? project.project.name ?? project.project.worktree, value: project.id, description: `${count} conversation${count !== 1 ? "s" : ""}`, onSelect: (dialog) => { dialog.clear(); void createOpencodeXProjectSession({ ...input, project }) } }
      })}
    />
  ))
}

export function manageOpencodeXSessionsDialog(input: OpencodeXDialogContext) {
  input.dialog.replace(() => <OpencodeXSessionManager />)
}

function OpencodeXSessionManager() {
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const local = useLocal()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = createSignal<string>()
  const projects = createMemo(() => sync.data.opencodex_project as OpencodeXProjectInfo[])
  const views = createMemo(() => sync.data.opencodex_view as OpencodeXViewInfo[])
  const currentSessionID = createMemo(() => route.data.type === "session" ? route.data.sessionID : undefined)
  const currentOption = createMemo<SessionManagerOptionValue | undefined>(() => route.data.type === "session" ? { type: "session", id: route.data.sessionID } : route.data.type === "opencodex-view" ? { type: "view", id: route.data.viewID } : undefined)
  const sessionMap = createMemo(() => new Map(sync.data.session.filter((session) => !session.parentID && !isSwarmSession(session)).map((session) => [session.id, session])))
  const mappedSessionIDs = createMemo(() => new Set(projects().flatMap((project) => project.sessionIDs)))
  const projectSessions = (project: OpencodeXProjectInfo) => project.sessionIDs.flatMap((sessionID) => sessionMap().get(sessionID) ?? []).filter((session) => !isSwarmSession(session)).toSorted((a, b) => b.time.updated - a.time.updated)
  const unassigned = createMemo(() => [...sessionMap().values()].filter((session) => !mappedSessionIDs().has(session.id)).toSorted((a, b) => b.time.updated - a.time.updated))
  const list = () => {
    void sync.session.refresh()
    refreshOpencodeXSidebar()
  }
  const categoryHeader = (section: string | undefined, category: string): JSX.Element => section
    ? <box flexDirection="column"><text fg={theme.accent} attributes={TextAttributes.BOLD}>{section}</text><text fg={theme.textMuted}>{category}</text></box>
    : <text fg={theme.accent} attributes={TextAttributes.BOLD}>{category}</text>
  const itemKey = (value: SessionManagerOptionValue) => `${value.type}:${value.id}`
  const buildOption = (session: Session, category: string, categoryView: JSX.Element) => {
    const value: SessionManagerOptionValue = { type: "session", id: session.id }
    const deleting = toDelete() === itemKey(value)
    return { title: deleting ? "Press delete again to confirm" : session.title, value, category, categoryView, bg: deleting ? theme.error : undefined, footer: local.session.isPinned(session.id) ? "pinned" : "", gutter: () => <text fg={statusColor(deriveStatus(session.id, sync))}>•</text> }
  }
  const buildViewOption = (view: OpencodeXViewInfo) => {
    const value: SessionManagerOptionValue = { type: "view", id: view.id }
    const deleting = toDelete() === itemKey(value)
    return { title: deleting ? "Press delete again to confirm" : view.title, value, category: "Views", categoryView: categoryHeader(undefined, "Views"), description: `${view.sessionIDs.length} session${view.sessionIDs.length === 1 ? "" : "s"}`, bg: deleting ? theme.error : undefined, footer: local.view.isPinned(view.id) ? "pinned" : "", gutter: () => <text fg={theme.primary}>v</text> }
  }
  const options = createMemo(() => {
    const result: Array<ReturnType<typeof buildOption> | ReturnType<typeof buildViewOption>> = []
    const now = Date.now()
    const appendSection = (section: string, recent: boolean) => {
      let first = true
      const appendGroup = (category: string, sessions: Session[]) => {
        if (sessions.length === 0) return
        const group = `${section} / ${category}`
        const header = categoryHeader(first ? section : undefined, category)
        first = false
        result.push(...sessions.map((session) => buildOption(session, group, header)))
      }
      for (const project of projects() ?? []) {
        const sessions = projectSessions(project)
        const recentSessions = sessions.filter((session) => clientSessionOrderBucketForStatus(deriveStatus(session.id, sync)) !== "inactive" || isRecentSessionUpdate(session.time.updated, now))
        const recentIDs = new Set(recentSessions.map((session) => session.id))
        appendGroup(project.name ?? project.project.name ?? project.project.worktree, recent ? recentSessions : sessions.filter((session) => !recentIDs.has(session.id)))
      }
      appendGroup("No Project", unassigned().filter((session) => (clientSessionOrderBucketForStatus(deriveStatus(session.id, sync)) !== "inactive" || isRecentSessionUpdate(session.time.updated, now)) === recent))
    }
    appendSection("Recent Sessions", true)
    result.push(...(views() ?? []).map(buildViewOption))
    appendSection("Prior Sessions", false)
    return result
  })

  async function deleteSession(sessionID: string) {
    const removed = await sdk.request<boolean>(`/experimental/opencodex/session/${sessionID}`, { method: "DELETE" }).catch((error: Error) => void DialogAlert.show(dialog, "Delete Session", error.message))
    if (!removed) return
    await sync.session.refresh()
    if (currentSessionID() === sessionID) route.navigate({ type: "home" })
    list()
    setToDelete(undefined)
  }
  async function deleteView(viewID: string) {
    const removed = await sdk.request<boolean>(`/experimental/opencodex/view/${viewID}`, { method: "DELETE" }).catch((error: Error) => void DialogAlert.show(dialog, "Delete View", error.message))
    if (!removed) return
    if (local.view.isPinned(viewID)) local.view.togglePin(viewID)
    if (route.data.type === "opencodex-view" && route.data.viewID === viewID) route.navigate({ type: "opencodex-dashboard" })
    list()
    setToDelete(undefined)
  }
  async function renameView(viewID: string) {
    const view = (views() ?? []).find((item) => item.id === viewID)
    if (!view) return
    const title = await DialogPrompt.show(dialog, "View name", { placeholder: "View name", value: view.title })
    if (title === null) return void dialog.replace(() => <OpencodeXSessionManager />)
    await sdk.request<OpencodeXViewInfo>(`/experimental/opencodex/view/${viewID}`, { method: "PATCH", body: JSON.stringify({ expectedTimeUpdated: view.timeUpdated, title: title.trim() }) }).then(() => { list(); dialog.replace(() => <OpencodeXSessionManager />) }).catch((error: Error) => DialogAlert.show(dialog, "Rename View", error.message))
  }
  async function reorderView(viewID: string, offset: number) {
    const ids = (views() ?? []).map((view) => view.id)
    const index = ids.indexOf(viewID)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
    const next = ids.map((id, itemIndex) => itemIndex === index ? ids[nextIndex] : itemIndex === nextIndex ? ids[index] : id)
    await sdk.request<OpencodeXViewInfo[]>("/experimental/opencodex/view/reorder", { method: "POST", body: JSON.stringify({ viewIDs: next }) }).then(() => { setToDelete(undefined); list() }).catch((error: Error) => DialogAlert.show(dialog, "Reorder Views", error.message))
  }
  function moveSession(sessionID: string) {
    const choices = projects() ?? []
    if (choices.length === 0) return void DialogAlert.show(dialog, "Move Session", "Create a project before moving sessions.")
    dialog.replace(() => <DialogSelect title="Move to project" options={choices.map((project) => ({
      title: project.name ?? project.project.name ?? project.project.worktree,
      value: project.id,
      description: (() => {
        const count = project.sessionIDs.filter((sessionID) => sessionMap().has(sessionID)).length
        return `${count} conversation${count === 1 ? "" : "s"}`
      })(),
      onSelect: (ctx) => {
        ctx.clear()
        void sdk.request<Session>("/experimental/opencodex/session/move", { method: "POST", body: JSON.stringify({ projectID: project.id, sessionID }) }).then(async () => { await sync.session.refresh(); list(); dialog.replace(() => <OpencodeXSessionManager />) }).catch((error: Error) => DialogAlert.show(dialog, "Move Session", error.message))
      },
    }))} />)
  }

  onMount(() => dialog.setSize("large"))
  return (
    <DialogSelect
      title="Manage Sessions"
      options={options()}
      current={currentOption()}
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => { route.navigate(option.value.type === "view" ? { type: "opencodex-view", viewID: option.value.id } : { type: "session", sessionID: option.value.id }); dialog.clear() }}
      actions={[
        { command: "session.pin.toggle", title: "pin/unpin", onTrigger: (option) => option.value.type === "view" ? local.view.togglePin(option.value.id) : local.session.togglePin(option.value.id) },
        { command: "session.delete", title: "delete", onTrigger: (option) => { const key = itemKey(option.value); if (toDelete() !== key) return setToDelete(key); if (option.value.type === "view") void deleteView(option.value.id); else void deleteSession(option.value.id) } },
        { command: "session.rename", title: "rename", onTrigger: (option) => option.value.type === "view" ? void renameView(option.value.id) : dialog.replace(() => <DialogSessionRename session={option.value.id} />) },
        { command: "opencodex.session.manage", title: "move", disabled: (projects() ?? []).length === 0, onTrigger: (option) => option.value.type === "session" && moveSession(option.value.id) },
        { command: "opencodex.project.move_up", title: "up", disabled: (views() ?? []).length < 2, onTrigger: (option) => option.value.type === "view" && void reorderView(option.value.id, -1) },
        { command: "opencodex.project.move_down", title: "down", disabled: (views() ?? []).length < 2, onTrigger: (option) => option.value.type === "view" && void reorderView(option.value.id, 1) },
        ...(sync.session.hasMore ? [{ command: "session.list", title: "load more", onTrigger: () => void sync.session.loadMore() }] : []),
      ]}
      footerHints={[{ title: "switch", label: "enter" }]}
    />
  )
}
