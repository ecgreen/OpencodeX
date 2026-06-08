import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogFolderPicker } from "@tui/ui/dialog-folder-picker"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogSessionRename } from "@tui/component/dialog-session-rename"
import { createColors, createFrames } from "@tui/ui/spinner"
import "opentui-spinner/solid"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { Part, Session } from "@opencode-ai/sdk/v2"
import { CLIENT_SESSION_SYNC_INTERVAL_MS } from "@opencode-ai/sdk/v2"
import { usePromptRef } from "@tui/context/prompt"
import { useBindings, useCommandShortcut } from "../keymap"
import { getPendingOpencodeXProjectSession, setPendingOpencodeXProjectSession } from "./opencodex-session-state"
import { NEW_RESULT_COLOR, deriveStatus, deriveViewStatus, statusColor, statusLabel, type DerivedStatus } from "./opencodex-session-status"
import { createOpencodeXViewDialog } from "./opencodex-view-dialog"
import { LogoShimmerText } from "./logo"
import { onOpencodeXRefresh, refreshOpencodeXSidebar } from "./opencodex-refresh"
import { isRecentSessionUpdate, recentProjectItems } from "./opencodex-session-recency"

export { onOpencodeXRefresh, refreshOpencodeXSidebar } from "./opencodex-refresh"

export const OPENCODEX_SIDEBAR_WIDTH = 36
const KV_KEY = "ox_sidebar_visible"
const SIDEBAR_BACKGROUND = RGBA.fromInts(0, 0, 0, 255)
const SIDEBAR_CARD_TITLE_WIDTH = 25
const SIDEBAR_CARD_DETAIL_WIDTH = 25
const SIDEBAR_CARD_PROGRESS_DETAIL_WIDTH = 21
const focusOpencodeXSidebarHandlers = new Set<() => void>()

export function focusOpencodeXSidebar() {
  focusOpencodeXSidebarHandlers.forEach((handler) => handler())
}

function onOpencodeXSidebarFocus(handler: () => void) {
  focusOpencodeXSidebarHandlers.add(handler)
  return () => {
    focusOpencodeXSidebarHandlers.delete(handler)
  }
}

export function useOxSidebar() {
  const kv = useKV()
  return kv.signal<boolean>(KV_KEY, false)
}

type OpencodeXProjectInfo = {
  id: string
  name?: string
  project: {
    id: string
    name?: string
    worktree: string
  }
  folders: { path: string }[]
  sessions: Session[]
}

type OpencodeXSwarmInfo = {
  id: string
  title: string
}

type OpencodeXViewInfo = {
  id: string
  title: string
  sessionIDs: string[]
  focusedSessionID?: string
}

type SessionManagerOptionValue =
  | { type: "session"; id: string }
  | { type: "view"; id: string }

type SidebarStatus = DerivedStatus | "review_ready" | "unviewed"

const REVIEW_READY_COLOR = NEW_RESULT_COLOR

type OpencodeXProjectValidation = {
  valid: boolean
  folders: {
    input: string
    path: string
    valid: boolean
    message?: string
  }[]
}

type OpencodeXDialogContext = {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  theme: ReturnType<typeof useTheme>["theme"]
  route?: ReturnType<typeof useRoute>
  sync?: ReturnType<typeof useSync>
  refetch?: () => void
}

type SidebarRow = {
  id: string
  activate: () => void
  collapse?: () => void
  expand?: () => void
  keepFocus?: boolean
  parentID?: string
}

function isSessionNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : (JSON.stringify(error) ?? String(error))
  return message.includes("Session not found")
}

function modelLabel(session: Session) {
  const model = session.model?.id ?? ""
  return model.slice(model.lastIndexOf("/") + 1)
}

function sessionSwarmID(session: Session) {
  const opencodex = session.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("swarmID" in opencodex)) return undefined
  return typeof opencodex.swarmID === "string" ? opencodex.swarmID : undefined
}

function isSwarmSession(session: Session) {
  return sessionSwarmID(session) !== undefined
}

function isPlaceholderTitle(title: string) {
  return title === "New session" || /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

function isEmptyPlaceholderSession(session: Session) {
  if (session.parentID) return false
  if (session.model || session.summary || session.share || session.revert) return false
  const tokens = session.tokens
  if (tokens && tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write > 0) return false
  if ((session.cost ?? 0) > 0) return false
  return isPlaceholderTitle(session.title)
}

function sessionSwarmTitle(session: Session, swarms: OpencodeXSwarmInfo[]) {
  const swarmID = sessionSwarmID(session)
  if (!swarmID) return undefined
  return swarms.find((swarm) => swarm.id === swarmID)?.title
}

function sessionTitle(session: Session, sync: ReturnType<typeof useSync>) {
  if (!session.title.startsWith("New session - ")) return session.title
  const firstUser = (sync.data.message[session.id] ?? []).find((message) => message.role === "user")
  if (!firstUser) return session.title
  const text = (sync.data.part[firstUser.id] ?? [])
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .find((part) => !("synthetic" in part && part.synthetic) && part.text.trim())?.text
    .trim()
    .split(/\r?\n/)[0]
  return text || session.title
}

function titleLabel(value: string, length: number) {
  return value.length > length ? value.slice(0, length - 3) + "..." : value
}

function projectTitle(project: OpencodeXProjectInfo) {
  return project.name ?? project.project.name ?? project.project.worktree
}

function sidebarStatusColor(status: SidebarStatus) {
  if (status === "unviewed" || status === "review_ready" || status === "needs_review") return REVIEW_READY_COLOR
  return statusColor(status)
}

function sidebarStatusLabel(status: SidebarStatus) {
  if (status === "unviewed") return "waiting for user to view"
  if (status === "review_ready") return "ready for review"
  return statusLabel(status)
}

async function confirmValidFolders(input: OpencodeXDialogContext & { folders: string[]; projectID?: string }) {
  const validation = await input.sdk
    .request<OpencodeXProjectValidation>("/experimental/opencodex/project/validate", {
      method: "POST",
      body: JSON.stringify({ projectID: input.projectID, folders: input.folders }),
    })
    .catch((error: Error) => {
      void DialogAlert.show(input.dialog, "Folder Validation", error.message)
    })
  if (!validation) return false
  if (!validation.valid) {
    await DialogAlert.show(
      input.dialog,
      "Folder Validation",
      validation.folders.length === 0
        ? "No folders configured."
        : validation.folders
            .filter((folder) => !folder.valid)
            .map((folder) => folder.message ?? `Invalid folder: ${folder.path}`)
            .slice(0, 4)
            .join("\n"),
    )
    return false
  }
  const confirmed = await DialogConfirm.show(
    input.dialog,
    "Use Project Folders",
    validation.folders.length === 0
      ? "No folders configured."
      : validation.folders.map((folder) => folder.path).join("\n"),
  )
  return confirmed === true
}

export async function createOpencodeXProjectDialog(input: OpencodeXDialogContext) {
  const name = await DialogPrompt.show(input.dialog, "Project name", {
    placeholder: "Optional display name",
  })
  if (name === null) return
  const initialDirectory = input.sdk.directory ?? process.cwd()
  const folders = await DialogFolderPicker.show(input.dialog, "Project folders", {
    initialDirectory,
  })
  if (folders === null) return
  if (!(await confirmValidFolders({ ...input, folders }))) return
  await input.sdk
    .request<OpencodeXProjectInfo>("/experimental/opencodex/project", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim() || undefined,
        folders,
        directory: input.sdk.directory,
      }),
    })
    .then(() => {
      input.refetch?.()
      refreshOpencodeXSidebar()
    })
    .catch((error: Error) => DialogAlert.show(input.dialog, "Project Error", error.message))
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
  const [projects, { refetch }] = createResource(refresh, () =>
    sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project"),
  )
  const sessionIDs = createMemo(
    () => new Set(sync.data.session.filter((session) => !session.parentID).map((session) => session.id)),
  )

  const list = () => {
    setRefresh((value) => value + 1)
    void refetch()
    refreshOpencodeXSidebar()
  }

  const options = createMemo(() =>
    (projects() ?? []).map((project) => {
      const count = project.sessions.filter((session) => sessionIDs().has(session.id)).length
      const isDeleting = toDelete() === project.id
      return {
        title: isDeleting ? "Press delete again to confirm" : projectTitle(project),
        value: project.id,
        description: `${project.folders.length} folder${project.folders.length !== 1 ? "s" : ""}, ${count} conversation${count !== 1 ? "s" : ""}${project.sessions.some((session) => deriveStatus(session.id, sync) !== "dormant") ? ", active" : ""}`,
        bg: isDeleting ? theme.error : undefined,
        footer: project.folders[0]?.path ?? "",
      }
    }),
  )

  async function deleteProject(projectID: string) {
    const removed = await sdk
      .request<boolean>(`/experimental/opencodex/project/${projectID}`, { method: "DELETE" })
      .catch((error: Error) => {
        void DialogAlert.show(dialog, "Delete Project", error.message)
      })
    if (!removed) return
    setToDelete(undefined)
    setCurrentProjectID(undefined)
    list()
  }

  async function renameProject(projectID: string) {
    const project = (projects() ?? []).find((item) => item.id === projectID)
    if (!project) return
    const name = await DialogPrompt.show(dialog, "Project name", {
      placeholder: "Optional display name",
      value: project.name ?? "",
    })
    if (name === null) {
      dialog.replace(() => <OpencodeXProjectManager />)
      return
    }
    await sdk
      .request<OpencodeXProjectInfo>(`/experimental/opencodex/project/${projectID}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      })
      .then(() => {
        setCurrentProjectID(projectID)
        list()
        dialog.replace(() => <OpencodeXProjectManager />)
      })
      .catch((error: Error) => DialogAlert.show(dialog, "Rename Project", error.message))
  }

  async function editProjectFolders(projectID: string) {
    const project = (projects() ?? []).find((item) => item.id === projectID)
    if (!project) return
    const folders = await DialogFolderPicker.show(dialog, "Project folders", {
      initialDirectory: project.folders[0]?.path ?? sdk.directory ?? project.project.worktree,
      selected: project.folders.map((folder) => folder.path),
    })
    if (folders === null) {
      dialog.replace(() => <OpencodeXProjectManager />)
      return
    }
    if (!(await confirmValidFolders({ sdk, dialog, theme, folders, projectID }))) return
    await sdk
      .request<OpencodeXProjectInfo>(`/experimental/opencodex/project/${projectID}`, {
        method: "PATCH",
        body: JSON.stringify({ folders }),
      })
      .then(() => {
        setCurrentProjectID(projectID)
        list()
        dialog.replace(() => <OpencodeXProjectManager />)
      })
      .catch((error: Error) => DialogAlert.show(dialog, "Project Folders", error.message))
  }

  async function reorderProject(projectID: string, offset: number) {
    const ids = (projects() ?? []).map((project) => project.id)
    const index = ids.indexOf(projectID)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
    const next = ids.map((id, itemIndex) =>
      itemIndex === index ? ids[nextIndex] : itemIndex === nextIndex ? ids[index] : id,
    )
    await sdk
      .request<OpencodeXProjectInfo[]>("/experimental/opencodex/project/reorder", {
        method: "POST",
        body: JSON.stringify({ projectIDs: next }),
      })
      .then(() => {
        setCurrentProjectID(projectID)
        setToDelete(undefined)
        list()
      })
      .catch((error: Error) => DialogAlert.show(dialog, "Reorder Projects", error.message))
  }

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Manage Projects"
      options={options()}
      current={currentProjectID()}
      onMove={(option) => {
        setCurrentProjectID(option.value)
        setToDelete(undefined)
      }}
      actions={[
        {
          command: "session.delete",
          title: "delete",
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              void deleteProject(option.value)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: (option) => {
            void renameProject(option.value)
          },
        },
        {
          command: "opencodex.project.folders",
          title: "folders",
          onTrigger: (option) => {
            void editProjectFolders(option.value)
          },
        },
        {
          command: "opencodex.project.move_up",
          title: "up",
          disabled: (projects() ?? []).length < 2,
          onTrigger: (option) => {
            void reorderProject(option.value, -1)
          },
        },
        {
          command: "opencodex.project.move_down",
          title: "down",
          disabled: (projects() ?? []).length < 2,
          onTrigger: (option) => {
            void reorderProject(option.value, 1)
          },
        },
      ]}
    />
  )
}

async function createProjectSession(input: OpencodeXDialogContext & { project: OpencodeXProjectInfo }) {
  const directory = input.sdk.directory ?? input.project.project.worktree
  const existing = input.sync?.data.session.find(
    (session) =>
      !session.parentID &&
      !session.model &&
      session.title.startsWith("New session - ") &&
      input.project.sessions.some((item) => item.id === session.id),
  )
  if (existing) {
    if (input.route?.data.type === "session" && input.route.data.sessionID === existing.id) return
    input.route?.navigate({ type: "session", sessionID: existing.id })
    return
  }

  const pending = getPendingOpencodeXProjectSession()
  if (pending?.projectID === input.project.id) {
    if (input.route?.data.type === "home") return
    input.route?.navigate({ type: "home" })
    return
  }

  setPendingOpencodeXProjectSession({ projectID: input.project.id, directory })
  input.route?.navigate({ type: "home" })
  input.refetch?.()
  refreshOpencodeXSidebar()
}

export async function newOpencodeXSessionInProjectDialog(input: OpencodeXDialogContext) {
  const projects = await input.sdk
    .request<OpencodeXProjectInfo[]>("/experimental/opencodex/project")
    .catch((error: Error) => {
      void DialogAlert.show(input.dialog, "New Session in Project", error.message)
    })
  if (!projects) return
  if (projects.length === 0) {
    await DialogAlert.show(input.dialog, "New Session in Project", "Create a project before starting project sessions.")
    return
  }
  const sessionCount = (project: OpencodeXProjectInfo) => {
    if (!input.sync) return project.sessions.length
    const sessionIDs = new Set(input.sync.data.session.filter((session) => !session.parentID).map((session) => session.id))
    return project.sessions.filter((session) => sessionIDs.has(session.id)).length
  }
  input.dialog.replace(() => (
    <DialogSelect
      title="New session in project"
      options={projects.map((project) => {
        const count = sessionCount(project)
        return {
          title: project.name ?? project.project.name ?? project.project.worktree,
          value: project.id,
          description: `${count} conversation${count !== 1 ? "s" : ""}`,
          onSelect: (dialog) => {
            dialog.clear()
            void createProjectSession({ ...input, project })
          },
        }
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
  const kv = useKV()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = createSignal<string>()
  const [refresh, setRefresh] = createSignal(0)
  const [projects, { refetch }] = createResource(refresh, () =>
    sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project"),
  )
  const [views, { refetch: refetchViews }] = createResource(refresh, () =>
    sdk.request<OpencodeXViewInfo[]>("/experimental/opencodex/view"),
  )
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const currentOption = createMemo<SessionManagerOptionValue | undefined>(() => {
    if (route.data.type === "session") return { type: "session", id: route.data.sessionID }
    if (route.data.type === "opencodex-view") return { type: "view", id: route.data.viewID }
    return undefined
  })
  const sessionMap = createMemo(
    () => new Map(sync.data.session.filter((session) => !session.parentID && !isSwarmSession(session)).map((session) => [session.id, session])),
  )
  const mappedSessionIDs = createMemo(
    () => new Set((projects() ?? []).flatMap((project) => project.sessions.map((session) => session.id))),
  )
  const projectSessions = (project: OpencodeXProjectInfo) =>
    project.sessions
      .filter((session) => !isSwarmSession(session))
      .map((session) => sessionMap().get(session.id) ?? session)
      .toSorted((a, b) => b.time.updated - a.time.updated)
  const unassigned = createMemo(() =>
    [...sessionMap().values()]
      .filter((session) => !mappedSessionIDs().has(session.id))
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const list = () => {
    setRefresh((value) => value + 1)
    void refetch()
    void refetchViews()
    refreshOpencodeXSidebar()
  }

  function projectLabel(project: OpencodeXProjectInfo) {
    return project.name ?? project.project.name ?? project.project.worktree
  }

  function categoryHeader(section: string | undefined, category: string): JSX.Element {
    if (!section) {
      return (
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {category}
        </text>
      )
    }
    return (
      <box flexDirection="column">
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {section}
        </text>
        <text fg={theme.textMuted}>{category}</text>
      </box>
    )
  }

  function itemKey(value: SessionManagerOptionValue) {
    return `${value.type}:${value.id}`
  }

  function buildOption(session: Session, category: string, categoryView: JSX.Element) {
    const value: SessionManagerOptionValue = { type: "session", id: session.id }
    const isDeleting = toDelete() === itemKey(value)
    return {
      title: isDeleting ? "Press delete again to confirm" : session.title,
      value,
      category,
      categoryView,
      bg: isDeleting ? theme.error : undefined,
      footer: local.session.isPinned(session.id) ? "pinned" : "",
      gutter: () => <text fg={statusColor(deriveStatus(session.id, sync))}>•</text>,
    }
  }

  function buildViewOption(view: OpencodeXViewInfo) {
    const value: SessionManagerOptionValue = { type: "view", id: view.id }
    const isDeleting = toDelete() === itemKey(value)
    return {
      title: isDeleting ? "Press delete again to confirm" : view.title,
      value,
      category: "Views",
      categoryView: categoryHeader(undefined, "Views"),
      description: `${view.sessionIDs.length} session${view.sessionIDs.length === 1 ? "" : "s"}`,
      bg: isDeleting ? theme.error : undefined,
      footer: local.view.isPinned(view.id) ? "pinned" : "",
      gutter: () => <text fg={theme.primary}>v</text>,
    }
  }

  const options = createMemo(() => {
    const result: Array<ReturnType<typeof buildOption> | ReturnType<typeof buildViewOption>> = []
    const now = Date.now()
    const appendSection = (section: string, recent: boolean) => {
      let first = true
      const appendGroup = (category: string, sessions: Session[]) => {
        if (sessions.length === 0) return
        const sectionLabel = first ? section : undefined
        first = false
        const group = `${section} / ${category}`
        const header = categoryHeader(sectionLabel, category)
        result.push(...sessions.map((session) => buildOption(session, group, header)))
      }

      for (const project of projects() ?? []) {
        const sessions = projectSessions(project)
        const recentSessions = recentProjectItems(sessions, (session) => session.time.updated, now)
        const recentSessionIDs = new Set(recentSessions.map((session) => session.id))
        appendGroup(
          projectLabel(project),
          recent ? recentSessions : sessions.filter((session) => !recentSessionIDs.has(session.id)),
        )
      }
      appendGroup(
        "No Project",
        unassigned().filter((session) => isRecentSessionUpdate(session.time.updated, now) === recent),
      )
    }

    appendSection("Recent Sessions", true)
    result.push(...(views() ?? []).map((view) => buildViewOption(view)))
    appendSection("Prior Sessions", false)
    return result
  })

  async function deleteSession(sessionID: string) {
    const removed = await sdk
      .request<boolean>(`/experimental/opencodex/session/${sessionID}`, { method: "DELETE" })
      .catch((error: Error) => {
        void DialogAlert.show(dialog, "Delete Session", error.message)
      })
    if (!removed) {
      return
    }
    await sync.session.refresh()
    if (currentSessionID() === sessionID) route.navigate({ type: "home" })
    list()
    setToDelete(undefined)
  }

  async function deleteView(viewID: string) {
    const removed = await sdk
      .request<boolean>(`/experimental/opencodex/view/${viewID}`, { method: "DELETE" })
      .catch((error: Error) => {
        void DialogAlert.show(dialog, "Delete View", error.message)
      })
    if (!removed) return
    if (local.view.isPinned(viewID)) local.view.togglePin(viewID)
    if (route.data.type === "opencodex-view" && route.data.viewID === viewID) {
      route.navigate({ type: "opencodex-dashboard" })
    }
    list()
    setToDelete(undefined)
  }

  async function renameView(viewID: string) {
    const view = (views() ?? []).find((item) => item.id === viewID)
    if (!view) return
    const title = await DialogPrompt.show(dialog, "View name", {
      placeholder: "View name",
      value: view.title,
    })
    if (title === null) {
      dialog.replace(() => <OpencodeXSessionManager />)
      return
    }
    await sdk
      .request<OpencodeXViewInfo>(`/experimental/opencodex/view/${viewID}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() }),
      })
      .then(() => {
        list()
        dialog.replace(() => <OpencodeXSessionManager />)
      })
      .catch((error: Error) => DialogAlert.show(dialog, "Rename View", error.message))
  }

  async function reorderView(viewID: string, offset: number) {
    const ids = (views() ?? []).map((view) => view.id)
    const index = ids.indexOf(viewID)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
    const next = ids.map((id, itemIndex) =>
      itemIndex === index ? ids[nextIndex] : itemIndex === nextIndex ? ids[index] : id,
    )
    await sdk
      .request<OpencodeXViewInfo[]>("/experimental/opencodex/view/reorder", {
        method: "POST",
        body: JSON.stringify({ viewIDs: next }),
      })
      .then(() => {
        setToDelete(undefined)
        list()
      })
      .catch((error: Error) => DialogAlert.show(dialog, "Reorder Views", error.message))
  }

  function moveSession(sessionID: string) {
    const choices = projects() ?? []
    if (choices.length === 0) {
      void DialogAlert.show(dialog, "Move Session", "Create a project before moving sessions.")
      return
    }
    dialog.replace(() => (
      <DialogSelect
        title="Move to project"
        options={choices.map((project) => {
          const count = project.sessions.filter((session) => sessionMap().has(session.id)).length
          return {
            title: projectLabel(project),
            value: project.id,
            description: `${count} conversation${count !== 1 ? "s" : ""}`,
            onSelect: (ctx) => {
              ctx.clear()
              void sdk
                .request<Session>("/experimental/opencodex/session/move", {
                  method: "POST",
                  body: JSON.stringify({ projectID: project.id, sessionID }),
                })
                .then(async () => {
                  await sync.session.refresh()
                  list()
                  dialog.replace(() => <OpencodeXSessionManager />)
                })
                .catch((error: Error) => DialogAlert.show(dialog, "Move Session", error.message))
            },
          }
        })}
      />
    ))
  }

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Manage Sessions"
      options={options()}
      current={currentOption()}
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        if (option.value.type === "view") route.navigate({ type: "opencodex-view", viewID: option.value.id })
        else route.navigate({ type: "session", sessionID: option.value.id })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: "pin/unpin",
          onTrigger: (option) => {
            if (option.value.type === "view") local.view.togglePin(option.value.id)
            else local.session.togglePin(option.value.id)
          },
        },
        {
          command: "session.delete",
          title: "delete",
          onTrigger: (option) => {
            const key = itemKey(option.value)
            if (toDelete() === key) {
              if (option.value.type === "view") void deleteView(option.value.id)
              else void deleteSession(option.value.id)
              return
            }
            setToDelete(key)
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: (option) => {
            if (option.value.type === "view") void renameView(option.value.id)
            else dialog.replace(() => <DialogSessionRename session={option.value.id} />)
          },
        },
        {
          command: "opencodex.session.manage",
          title: "move",
          disabled: (projects() ?? []).length === 0,
          onTrigger: (option) => {
            if (option.value.type === "session") moveSession(option.value.id)
          },
        },
        {
          command: "opencodex.project.move_up",
          title: "up",
          disabled: (views() ?? []).length < 2,
          onTrigger: (option) => {
            if (option.value.type === "view") void reorderView(option.value.id, -1)
          },
        },
        {
          command: "opencodex.project.move_down",
          title: "down",
          disabled: (views() ?? []).length < 2,
          onTrigger: (option) => {
            if (option.value.type === "view") void reorderView(option.value.id, 1)
          },
        },
      ]}
      footerHints={[{ title: "switch", label: "enter" }]}
    />
  )
}

export function OpencodeXSidebar() {
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const promptRef = usePromptRef()
  const { theme } = useTheme()
  const [open, setOpen] = useOxSidebar()
  const focusShortcut = useCommandShortcut("opencodex.sidebar.focus")
  const toggleShortcut = useCommandShortcut("opencodex.sidebar.toggle")
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [projectsCollapsed, setProjectsCollapsed] = createSignal(false)
  const [sessionsCollapsed, setSessionsCollapsed] = createSignal(false)
  const [priorSessionsCollapsed, setPriorSessionsCollapsed] = createSignal(true)
  const [viewsCollapsed, setViewsCollapsed] = createSignal(false)
  const [refresh, setRefresh] = createSignal(0)
  const [sidebarFocused, setSidebarFocused] = createSignal(false)
  const [selectedRowID, setSelectedRowID] = createSignal<string>()
  let sidebarScroll: ScrollBoxRenderable | undefined
  let refreshRunning = false

  const refreshSidebar = () => {
    if (refreshRunning) return
    refreshRunning = true
    setRefresh((value) => value + 1)
    void sync.session.refresh().catch(() => {}).finally(() => {
      refreshRunning = false
    })
  }
  onCleanup(onOpencodeXRefresh(refreshSidebar))

  onMount(() => {
    const timer = setInterval(refreshSidebar, CLIENT_SESSION_SYNC_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const projects = createMemo(() => sync.data.opencodex_project as OpencodeXProjectInfo[])
  const refetch = () => void sync.session.refresh()
  const [swarms] = createResource(refresh, () =>
    sdk.request<OpencodeXSwarmInfo[]>("/experimental/opencodex/swarm"),
  )
  const views = createMemo(() => sync.data.opencodex_view as OpencodeXViewInfo[])

  const sessions = createMemo(() =>
    sync.data.session.filter((s) => !s.parentID).toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const [missingSessionState] = createResource(
    () => sessions().map((session) => session.id).join("\n"),
    async () => {
      const entries = await Promise.all(
        sessions().map(async (session) => {
          const result = await sdk.client.session.get({ sessionID: session.id })
          if (result.error && isSessionNotFound(result.error)) return session.id
          return undefined
        }),
      )
      return entries.filter((sessionID): sessionID is string => sessionID !== undefined)
    },
  )
  const missingSessionIDs = createMemo(() => new Set(missingSessionState() ?? []))
  const visibleSessions = createMemo(() => sessions().filter((session) => !missingSessionIDs().has(session.id)))
  const sessionByID = createMemo(() => new Map(visibleSessions().map((session) => [session.id, session])))
  const allSessionByID = createMemo(
    () =>
      new Map([
        ...(projects() ?? []).flatMap((project) =>
          project.sessions
            .filter((session) => !missingSessionIDs().has(session.id))
            .map((session) => [session.id, session] as const),
        ),
        ...visibleSessions().map((session) => [session.id, session] as const),
      ]),
  )

  const projectIDBySessionID = createMemo(
    () =>
      new Map(
        (projects() ?? []).flatMap((project) =>
          project.sessions.map((session) => [session.id, project.id] as const),
        ),
      ),
  )
  const projectTitleBySessionID = createMemo(
    () =>
      new Map(
        (projects() ?? []).flatMap((project) =>
          project.sessions.map((session) => [session.id, projectTitle(project)] as const),
        ),
      ),
  )
  const allSidebarSessions = createMemo(() =>
    [...allSessionByID().values()]
      .filter((session) => !session.parentID && !isSwarmSession(session) && !isEmptyPlaceholderSession(session))
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const recentSessions = createMemo(() => allSidebarSessions().filter((session) => isRecentSessionUpdate(session.time.updated)))
  const priorSessions = createMemo(() => allSidebarSessions().filter((session) => !isRecentSessionUpdate(session.time.updated)))
  const recentSessionIDs = createMemo(() => new Set(recentSessions().map((session) => session.id)))
  const priorSessionIDs = createMemo(() => new Set(priorSessions().map((session) => session.id)))
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const currentViewID = createMemo(() => (route.data.type === "opencodex-view" ? route.data.viewID : undefined))
  const pendingProjectSession = createMemo(() => getPendingOpencodeXProjectSession())
  const activeRowID = createMemo(() => {
    if (route.data.type === "opencodex-dashboard") return "nav:dashboard"
    if (route.data.type === "session") {
      if (recentSessionIDs().has(route.data.sessionID)) return `recent-session:${route.data.sessionID}`
      if (priorSessionIDs().has(route.data.sessionID)) return `prior-session:${route.data.sessionID}`
      const projectID = projectIDBySessionID().get(route.data.sessionID)
      if (projectID) return `project-session:${projectID}:${route.data.sessionID}`
      return `session:${route.data.sessionID}`
    }
    if (route.data.type === "opencodex-view") return `view:${route.data.viewID}`
    if (route.data.type === "home" && pendingProjectSession()) return `pending:${pendingProjectSession()?.projectID}`
    return undefined
  })

  const projectSessions = (project: OpencodeXProjectInfo) =>
    recentProjectItems(
      project.sessions
        .filter((session) => !missingSessionIDs().has(session.id))
        .map((session) => sessionByID().get(session.id) ?? session)
        .filter((session) => !isSwarmSession(session))
        .filter((session) => !isEmptyPlaceholderSession(session)),
      (session) => session.time.updated,
    )

  function sessionRowID(section: "project" | "recent" | "prior", sessionID: string, projectID?: string) {
    if (section === "project") return `project-session:${projectID}:${sessionID}`
    if (section === "recent") return `recent-session:${sessionID}`
    return `prior-session:${sessionID}`
  }

  function sessionIDFromRow(rowID: string) {
    if (rowID.startsWith("session:")) return rowID.slice("session:".length)
    if (rowID.startsWith("recent-session:")) return rowID.slice("recent-session:".length)
    if (rowID.startsWith("prior-session:")) return rowID.slice("prior-session:".length)
    if (rowID.startsWith("project-session:")) return rowID.slice(rowID.lastIndexOf(":") + 1)
  }

  const toggleProject = (projectID: string) =>
    setCollapsed((state) => ({ ...state, [projectID]: !(state[projectID] ?? false) }))

  const setProjectCollapsed = (projectID: string, value: boolean) =>
    setCollapsed((state) => ({ ...state, [projectID]: value }))

  const sidebarRows = createMemo((): SidebarRow[] => [
    {
      id: "nav:dashboard",
      activate: () => route.navigate({ type: "opencodex-dashboard" }),
    },
    {
      id: "section:projects",
      activate: () => setProjectsCollapsed((value) => !value),
      collapse: () => setProjectsCollapsed(true),
      expand: () => setProjectsCollapsed(false),
      keepFocus: true,
    },
    ...(projectsCollapsed()
      ? []
      : (projects() ?? []).length === 0
        ? [
            {
              id: "empty:projects",
              activate: () => void createProject(),
              parentID: "section:projects",
            },
          ]
        : (projects() ?? []).flatMap((project) => {
            const isCollapsed = collapsed()[project.id] ?? false
            const parentID = `project:${project.id}`
            const children = [
              ...(pendingProjectSession()?.projectID === project.id
                ? [
                    {
                      id: `pending:${project.id}`,
                      activate: () => route.navigate({ type: "home" }),
                      parentID,
                    },
                  ]
                : []),
              ...projectSessions(project).map((session) => ({
                id: sessionRowID("project", session.id, project.id),
                activate: () => route.navigate({ type: "session", sessionID: session.id }),
                parentID,
              })),
            ]
            return [
              {
                id: parentID,
                activate: () => toggleProject(project.id),
                collapse: () => setProjectCollapsed(project.id, true),
                expand: () => setProjectCollapsed(project.id, false),
                keepFocus: true,
                parentID: "section:projects",
              },
              ...(isCollapsed
                ? []
                : children.length > 0
                  ? children
                  : [
                      {
                        id: `empty:project:${project.id}`,
                        activate: () => void createSession(project),
                        parentID,
                      },
                    ]),
            ]
          })),
    {
      id: "section:sessions",
      activate: () => setSessionsCollapsed((value) => !value),
      collapse: () => setSessionsCollapsed(true),
      expand: () => setSessionsCollapsed(false),
      keepFocus: true,
    },
    ...(sessionsCollapsed()
      ? []
      : recentSessions().length > 0
        ? recentSessions().map((session) => ({
            id: sessionRowID("recent", session.id),
            activate: () => route.navigate({ type: "session", sessionID: session.id }),
            parentID: "section:sessions",
          }))
        : [
            {
              id: "empty:sessions",
              activate: createBlankSession,
              parentID: "section:sessions",
            },
          ]),
    {
      id: "section:views",
      activate: () => setViewsCollapsed((value) => !value),
      collapse: () => setViewsCollapsed(true),
      expand: () => setViewsCollapsed(false),
      keepFocus: true,
    },
    ...(viewsCollapsed()
      ? []
      : (views() ?? []).length > 0
        ? (views() ?? []).map((view) => ({
            id: `view:${view.id}`,
            activate: () => route.navigate({ type: "opencodex-view", viewID: view.id }),
            parentID: "section:views",
          }))
        : [
            {
              id: "empty:views",
              activate: createView,
              parentID: "section:views",
            },
          ]),
    {
      id: "section:prior-sessions",
      activate: () => setPriorSessionsCollapsed((value) => !value),
      collapse: () => setPriorSessionsCollapsed(true),
      expand: () => setPriorSessionsCollapsed(false),
      keepFocus: true,
    },
    ...(priorSessionsCollapsed()
      ? []
      : priorSessions().map((session) => ({
          id: sessionRowID("prior", session.id),
          activate: () => route.navigate({ type: "session", sessionID: session.id }),
          parentID: "section:prior-sessions",
        }))),
  ])
  const scrollRows = createMemo(() => sidebarRows().filter((row) => row.id !== "nav:dashboard"))

  const selectedRow = createMemo(() => sidebarRows().find((row) => row.id === selectedRowID()))

  async function createProject() {
    await createOpencodeXProjectDialog({ sdk, dialog, theme, refetch })
  }

  async function createSession(project: OpencodeXProjectInfo) {
    await createProjectSession({ sdk, dialog, theme, route, sync, refetch, project })
  }

  function createBlankSession() {
    setPendingOpencodeXProjectSession(undefined)
    route.navigate({ type: "home" })
    dialog.clear()
  }

  function createView() {
    void createOpencodeXViewDialog({
      sdk,
      dialog,
      route,
      sessionIDs: currentSessionID() ? [currentSessionID()!] : undefined,
    })
  }

  function rowExists(rowID: string | undefined) {
    if (!rowID) return false
    return sidebarRows().some((row) => row.id === rowID)
  }

  function activeParentRowID() {
    if (route.data.type === "session") {
      if (recentSessionIDs().has(route.data.sessionID)) return "section:sessions"
      if (priorSessionIDs().has(route.data.sessionID)) return "section:prior-sessions"
      const projectID = projectIDBySessionID().get(route.data.sessionID)
      if (projectID && rowExists(`project:${projectID}`)) return `project:${projectID}`
      if (projectID) return "section:projects"
      return "section:sessions"
    }
    if (route.data.type === "opencodex-view") return "section:views"
    const pending = pendingProjectSession()
    if (route.data.type === "home" && pending) {
      if (rowExists(`project:${pending.projectID}`)) return `project:${pending.projectID}`
      return "section:projects"
    }
    return undefined
  }

  function selectRow(rowID?: string) {
    const activeID = activeRowID()
    const parentID = activeParentRowID()
    setSelectedRowID(
      rowExists(rowID)
        ? rowID
        : rowExists(activeID)
          ? activeID
          : rowExists(parentID)
            ? parentID
            : sidebarRows()[0]?.id,
    )
  }

  function moveSidebarSelection(offset: number) {
    const rows = sidebarRows()
    if (rows.length === 0) return
    const current = rows.findIndex((row) => row.id === selectedRowID())
    const next = current < 0 ? 0 : (current + offset + rows.length) % rows.length
    const nextID = rows[next]?.id
    setSelectedRowID(nextID)
    scheduleSidebarScrollSync(nextID)
  }

  function exitSidebarFocus() {
    setSidebarFocused(false)
    setTimeout(() => promptRef.current?.focus(), 0)
  }

  function enterSidebarFocus() {
    if (!open()) setOpen(() => true)
    setSidebarFocused(true)
    promptRef.current?.blur()
    selectRow(activeRowID() ?? selectedRowID())
    scheduleSidebarScrollSync()
  }

  function activateSelectedRow() {
    const row = selectedRow()
    if (!row) return
    row.activate()
    scheduleSidebarScrollSync(row.id)
    if (!row.keepFocus) exitSidebarFocus()
  }

  function collapseSelectedRow() {
    const row = selectedRow()
    if (!row) return
    if (row.collapse) {
      row.collapse()
      scheduleSidebarScrollSync(row.id)
      return
    }
    const parent = sidebarRows().find((item) => item.id === row.parentID)
    if (!parent?.collapse) return
    setSelectedRowID(parent.id)
    parent.collapse()
    scheduleSidebarScrollSync(parent.id)
  }

  function expandSelectedRow() {
    const row = selectedRow()
    row?.expand?.()
    scheduleSidebarScrollSync(row?.id)
  }

  function clampSidebarScroll() {
    const scroll = sidebarScroll
    if (!scroll || scroll.isDestroyed) return
    const maxScroll = Math.max(0, scroll.scrollHeight - (scroll.viewport?.height ?? scroll.height))
    if (scroll.y > maxScroll) scroll.scrollTo(maxScroll)
  }

  function scrollSidebarRowIntoView(rowID?: string) {
    const scroll = sidebarScroll
    const targetID = rowID ?? selectedRowID()
    if (!scroll || scroll.isDestroyed || !targetID) return
    const target = scroll.getChildren().find((child: { id?: string }) => child.id === targetID)
    if (!target) return
    const viewportHeight = scroll.viewport?.height ?? scroll.height
    const y = target.y - scroll.y
    const bottom = y + Math.max(1, target.height ?? 1)
    if (y < 0) {
      scroll.scrollBy(y)
      return
    }
    if (bottom > viewportHeight) scroll.scrollBy(bottom - viewportHeight)
  }

  function syncSidebarScroll(rowID?: string) {
    clampSidebarScroll()
    scrollSidebarRowIntoView(rowID)
  }

  function scheduleSidebarClamp() {
    setTimeout(clampSidebarScroll, 0)
    requestAnimationFrame(clampSidebarScroll)
  }

  function scheduleSidebarScrollSync(rowID?: string) {
    setTimeout(() => syncSidebarScroll(rowID), 0)
    requestAnimationFrame(() => syncSidebarScroll(rowID))
  }

  onCleanup(onOpencodeXSidebarFocus(enterSidebarFocus))

  createEffect(() => {
    if (open()) return
    setSidebarFocused(false)
  })

  createEffect(() => {
    const rows = sidebarRows()
    if (rows.length === 0) {
      setSelectedRowID(undefined)
      return
    }
    if (rowExists(selectedRowID())) return
    selectRow(selectedRowID())
  })

  createEffect(
    on(
      () => sidebarRows().map((row) => row.id).join("\n"),
      () => {
        if (sidebarFocused()) {
          scheduleSidebarScrollSync()
          return
        }
        scheduleSidebarClamp()
      },
    ),
  )

  createEffect(
    on(selectedRowID, (rowID) => {
      if (!sidebarFocused()) return
      scheduleSidebarScrollSync(rowID)
    }),
  )

  useBindings(() => ({
    enabled: sidebarFocused(),
    commands: [
      {
        name: "opencodex.sidebar.next",
        title: "Next sidebar item",
        category: "OpencodeX Sidebar",
        hidden: true,
        run: () => moveSidebarSelection(1),
      },
      {
        name: "opencodex.sidebar.previous",
        title: "Previous sidebar item",
        category: "OpencodeX Sidebar",
        hidden: true,
        run: () => moveSidebarSelection(-1),
      },
      {
        name: "opencodex.sidebar.open",
        title: "Open sidebar item",
        category: "OpencodeX Sidebar",
        hidden: true,
        run: activateSelectedRow,
      },
      {
        name: "opencodex.sidebar.close_focus",
        title: "Return to prompt",
        category: "OpencodeX Sidebar",
        hidden: true,
        run: exitSidebarFocus,
      },
      {
        name: "opencodex.sidebar.collapse",
        title: "Collapse sidebar item",
        category: "OpencodeX Sidebar",
        hidden: true,
        run: collapseSelectedRow,
      },
      {
        name: "opencodex.sidebar.expand",
        title: "Expand sidebar item",
        category: "OpencodeX Sidebar",
        hidden: true,
        run: expandSelectedRow,
      },
    ],
    bindings: [
      { key: "down,j", desc: "Next sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.next" },
      { key: "up,k", desc: "Previous sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.previous" },
      { key: "return", desc: "Open sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.open" },
      { key: "escape", desc: "Return to prompt", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.close_focus" },
      { key: "left,h", desc: "Collapse sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.collapse" },
      { key: "right,l", desc: "Expand sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.expand" },
    ],
  }))

  const isRowSelected = (rowID: string | undefined) => sidebarFocused() && rowID === selectedRowID()
  const rowBackground = (rowID: string | undefined, active: boolean) =>
    isRowSelected(rowID) || active ? (theme.backgroundMenu ?? theme.backgroundElement) : undefined
  const rowCardBackground = (rowID: string | undefined, active: boolean) =>
    isRowSelected(rowID) || active ? (theme.backgroundMenu ?? theme.backgroundElement) : theme.backgroundPanel
  const rowTextColor = (rowID: string | undefined, fallback = theme.textMuted) =>
    isRowSelected(rowID) ? theme.text : fallback

  const dashboardItem = () => {
    const rowID = "nav:dashboard"
    const active = createMemo(() => route.data.type === "opencodex-dashboard")
    return (
      <box
        id={rowID}
        flexShrink={0}
        marginBottom={1}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        alignItems="center"
        backgroundColor={rowBackground(rowID, active())}
        onMouseUp={() => {
          setSelectedRowID(rowID)
          route.navigate({ type: "opencodex-dashboard" })
        }}
      >
        <text>
          <span style={{ fg: theme.text }}>
            <b>Opencode</b>
          </span>
          <span style={{ fg: theme.warning }}>
            <b>X</b>
          </span>
        </text>
        <text fg={theme.textMuted}> Dashboard</text>
      </box>
    )
  }

  const sectionHeader = (title: string, input?: { collapsed: boolean; toggle(): void; action?: () => void; rowID?: string }) => (
    <box
      id={input?.rowID}
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={rowBackground(input?.rowID, false)}
      onMouseUp={() => {
        if (!input) return
        setSelectedRowID(input.rowID)
        input.toggle()
        scheduleSidebarScrollSync(input.rowID)
      }}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={rowTextColor(input?.rowID, theme.text)}>
          <b>{input ? `${input.collapsed ? "[+] " : "[-] "}` : ""}{title}</b>
        </text>
        {input?.action ? projectIconButton("+", input.action, rowTextColor(input.rowID, theme.textMuted)) : undefined}
      </box>
      <box width="100%" border={["bottom"]} borderColor={theme.borderSubtle} />
    </box>
  )

  const sessionItem = (session: Session, input?: { subtitle?: string; titleSuffix?: string; rowID?: string }) => {
    const rowID = input?.rowID ?? `session:${session.id}`
    const status = createMemo(() => deriveStatus(session.id, sync))
    const active = createMemo(() => currentSessionID() === session.id)
    const title = createMemo(() => [sessionTitle(session, sync), input?.titleSuffix].filter(Boolean).join(" - "))
    const detail = createMemo(() => [input?.subtitle, sessionSwarmTitle(session, swarms() ?? []) ?? modelLabel(session)].filter(Boolean).join(" - "))
    const unviewed = createMemo(() => status() === "dormant" && (sync.data.session_ui_state[session.id]?.updated ?? false))
    const displayStatus = createMemo<SidebarStatus>(() => unviewed() ? "unviewed" : status())
    const statusFg = createMemo(() => sidebarStatusColor(displayStatus()))
    const attentionTitle = createMemo(() => ["unviewed", "review_ready", "needs_review"].includes(displayStatus()))
    const textColor = createMemo(() => {
      if (attentionTitle()) return statusFg()
      if (status() !== "dormant") return statusColor(status())
      return active() ? theme.text : theme.textMuted
    })
    const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
    const animatedTitle = createMemo(() => animationsEnabled() && (displayStatus() === "input_needed" || attentionTitle()))
    const showDetailProgress = createMemo(() => status() === "in_progress")
    const showDetailSpinner = createMemo(() => showDetailProgress() && animationsEnabled())
    const spinnerDef = createMemo(() => {
      const color = statusColor("in_progress")
      return {
        frames: createFrames({
          color,
          width: 3,
          style: "diamonds",
          inactiveFactor: 0.5,
          minAlpha: 0.3,
        }),
        color: createColors({
          color,
          width: 3,
          style: "diamonds",
          inactiveFactor: 0.5,
          minAlpha: 0.3,
        }),
      }
    })

    return (
      <box
        id={rowID}
        flexShrink={0}
        marginBottom={1}
        marginLeft={1}
        marginRight={1}
        flexDirection="column"
        backgroundColor={rowCardBackground(rowID, active())}
        onMouseUp={() => {
          setSelectedRowID(rowID)
          route.navigate({ type: "session", sessionID: session.id })
        }}
      >
        <box flexDirection="column" border={["left"]} borderColor={attentionTitle() ? statusFg() : isRowSelected(rowID) ? theme.primary : statusFg()}>
          <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1} alignItems="center">
            <Show
              when={animatedTitle()}
              fallback={
                <text
                  attributes={TextAttributes.BOLD}
                  fg={attentionTitle() ? statusFg() : rowTextColor(rowID, textColor())}
                  overflow="hidden"
                  wrapMode="none"
                  truncate
                >
                  {titleLabel(title(), SIDEBAR_CARD_TITLE_WIDTH)}
                </text>
              }
            >
              <LogoShimmerText
                text={titleLabel(title(), SIDEBAR_CARD_TITLE_WIDTH)}
                ink={attentionTitle() ? statusFg() : rowTextColor(rowID, textColor())}
                attributes={TextAttributes.BOLD}
                wrapMode="none"
                truncate
              />
            </Show>
          </box>
          <Show when={detail()} fallback={<box height={1} paddingLeft={1} paddingRight={1} />}>
            <box height={1} paddingLeft={1} paddingRight={1} width="100%" flexDirection="row" alignItems="center" justifyContent="space-between">
              <text fg={theme.textMuted} overflow="hidden" wrapMode="none" truncate flexShrink={1}>
                {titleLabel(detail(), showDetailProgress() ? SIDEBAR_CARD_PROGRESS_DETAIL_WIDTH : SIDEBAR_CARD_DETAIL_WIDTH)}
              </text>
              <Show when={!animationsEnabled() && status() === "in_progress"}>
                <text fg={statusColor("in_progress")}>...</text>
              </Show>
              <Show when={showDetailSpinner()}>
                <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
              </Show>
            </box>
          </Show>
        </box>
      </box>
    )
  }

  const pendingSessionItem = (rowID: string) => (
    <box
      id={rowID}
      flexShrink={0}
      marginBottom={1}
      marginLeft={1}
      marginRight={1}
      flexDirection="column"
      backgroundColor={rowCardBackground(rowID, route.data.type === "home")}
      onMouseUp={() => {
        setSelectedRowID(rowID)
        route.navigate({ type: "home" })
      }}
    >
      <box flexDirection="column" border={["left"]} borderColor={isRowSelected(rowID) ? theme.primary : statusColor("dormant")}>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1} alignItems="center">
          <text
            fg={rowTextColor(rowID, route.data.type === "home" ? theme.text : theme.textMuted)}
            overflow="hidden"
            wrapMode="none"
            truncate
          >
            {titleLabel("New session", SIDEBAR_CARD_TITLE_WIDTH)}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted} wrapMode="none">pending</text>
        </box>
      </box>
    </box>
  )

  const viewItem = (view: OpencodeXViewInfo) => {
    const rowID = `view:${view.id}`
    const active = createMemo(() => currentViewID() === view.id)
    const sessionsByID = createMemo(() => new Map(sync.data.session.map((session) => [session.id, session])))
    const status = createMemo<SidebarStatus>(() => {
      const base = deriveViewStatus(view.sessionIDs, sync)
      if (base !== "dormant") return base
      const sessions = view.sessionIDs.map((sessionID) => sessionsByID().get(sessionID)).filter((session): session is Session => session !== undefined)
      return sessions.some((session) => sync.data.session_ui_state[session.id]?.updated ?? false) ? "unviewed" : "dormant"
    })
    const statusFg = createMemo(() => sidebarStatusColor(status()))
    const statusText = createMemo(() => sidebarStatusLabel(status()))
    const attentionTitle = createMemo(() => ["unviewed", "review_ready", "needs_review"].includes(status()))
    const textColor = createMemo(() => {
      if (attentionTitle()) return statusFg()
      if (status() !== "dormant") return statusFg()
      return active() ? theme.text : theme.textMuted
    })
    const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
    const animatedTitle = createMemo(() => animationsEnabled() && (status() === "input_needed" || attentionTitle()))
    const showProgress = createMemo(() => status() === "in_progress")
    const spinnerDef = createMemo(() => {
      const color = statusColor("in_progress")
      return {
        frames: createFrames({
          color,
          width: 4,
          style: "diamonds",
          inactiveFactor: 0.5,
          minAlpha: 0.3,
        }),
        color: createColors({
          color,
          width: 4,
          style: "diamonds",
          inactiveFactor: 0.5,
          minAlpha: 0.3,
        }),
      }
    })
    return (
      <box
        id={rowID}
        flexShrink={0}
        marginBottom={1}
        marginLeft={1}
        marginRight={1}
        flexDirection="column"
        backgroundColor={rowCardBackground(rowID, active())}
        onMouseUp={() => {
          setSelectedRowID(rowID)
          route.navigate({ type: "opencodex-view", viewID: view.id })
        }}
      >
        <box flexDirection="column" border={["left"]} borderColor={attentionTitle() ? statusFg() : isRowSelected(rowID) ? theme.primary : statusFg()}>
          <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" gap={1} alignItems="center">
            <Show
              when={animatedTitle()}
              fallback={
                <text
                  attributes={TextAttributes.BOLD}
                  fg={attentionTitle() ? statusFg() : rowTextColor(rowID, textColor())}
                  overflow="hidden"
                  wrapMode="none"
                  truncate
                >
                  {titleLabel(view.title, SIDEBAR_CARD_TITLE_WIDTH)}
                </text>
              }
            >
              <LogoShimmerText
                text={titleLabel(view.title, SIDEBAR_CARD_TITLE_WIDTH)}
                ink={attentionTitle() ? statusFg() : rowTextColor(rowID, textColor())}
                attributes={TextAttributes.BOLD}
                wrapMode="none"
                truncate
              />
            </Show>
          </box>
          <box height={1} paddingLeft={1} paddingRight={1} width="100%" flexDirection="row" alignItems="center" justifyContent="space-between">
            <text fg={theme.textMuted} wrapMode="none">
              {view.sessionIDs.length} session{view.sessionIDs.length === 1 ? "" : "s"}
            </text>
            <Show
              when={showProgress()}
              fallback={<text fg={statusFg()} wrapMode="none">{titleLabel(statusText(), 17)}</text>}
            >
              <Show when={animationsEnabled()} fallback={<text fg={statusColor("in_progress")}>...</text>}>
                <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
              </Show>
            </Show>
          </box>
        </box>
      </box>
    )
  }

  const projectItem = (project: OpencodeXProjectInfo) => {
    const rowID = `project:${project.id}`
    const isCollapsed = createMemo(() => collapsed()[project.id] ?? false)
    const childCount = createMemo(() => projectSessions(project).length + (pendingProjectSession()?.projectID === project.id ? 1 : 0))
    const expandIcon = createMemo(() => (isCollapsed() ? "▸" : "▾"))
    const label = createMemo(() => {
      const count = ` (${childCount()})`
      const maxWidth = 28
      return `${titleLabel(projectTitle(project), maxWidth - count.length)}${count}`
    })
    return (
      <box
        id={rowID}
        flexShrink={0}
        marginBottom={1}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={rowBackground(rowID, false)}
        onMouseUp={() => {
          setSelectedRowID(rowID)
          toggleProject(project.id)
          scheduleSidebarScrollSync(rowID)
        }}
      >
        <box flexDirection="row" gap={1}>
          <text fg={rowTextColor(rowID, theme.textMuted)}>{expandIcon()}</text>
          <text fg={rowTextColor(rowID, theme.text)}>
            <b>{label()}</b>
          </text>
        </box>
        <box flexDirection="row">
          {projectIconButton("+", () => void createSession(project), rowTextColor(rowID, theme.textMuted))}
        </box>
      </box>
    )
  }

  const emptyItem = (rowID: string, label: string, actionLabel: string, action: () => void) => (
    <box
      id={rowID}
      flexShrink={0}
      marginBottom={1}
      paddingLeft={2}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={rowBackground(rowID, false)}
      onMouseUp={() => {
        setSelectedRowID(rowID)
        action()
      }}
    >
      <text fg={rowTextColor(rowID, theme.textMuted)}>{label}</text>
      <text fg={isRowSelected(rowID) ? theme.text : theme.textMuted}>{actionLabel}</text>
    </box>
  )

  const projectIconButton = (label: string, onPress: () => void, color = theme.textMuted) => (
    <box
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={(event: { stopPropagation(): void }) => event.stopPropagation()}
      onMouseUp={(event: { stopPropagation(): void }) => {
        event.stopPropagation()
        onPress()
      }}
    >
      <text fg={color}>{label}</text>
    </box>
  )

  const renderSidebarRow = (row: SidebarRow) => {
    if (row.id === "section:projects") {
      return sectionHeader("Projects", {
        collapsed: projectsCollapsed(),
        toggle: () => setProjectsCollapsed((value) => !value),
        action: () => void createProject(),
        rowID: row.id,
      })
    }
    if (row.id === "section:sessions") {
      return sectionHeader("Recent Sessions", {
        collapsed: sessionsCollapsed(),
        toggle: () => setSessionsCollapsed((value) => !value),
        action: createBlankSession,
        rowID: row.id,
      })
    }
    if (row.id === "section:prior-sessions") {
      return sectionHeader("Prior Sessions", {
        collapsed: priorSessionsCollapsed(),
        toggle: () => setPriorSessionsCollapsed((value) => !value),
        rowID: row.id,
      })
    }
    if (row.id === "section:views") {
      return sectionHeader("Views", {
        collapsed: viewsCollapsed(),
        toggle: () => setViewsCollapsed((value) => !value),
        action: createView,
        rowID: row.id,
      })
    }
    if (row.id.startsWith("project:")) {
      const project = (projects() ?? []).find((item) => item.id === row.id.slice("project:".length))
      return project ? projectItem(project) : <></>
    }
    if (row.id.startsWith("pending:")) return pendingSessionItem(row.id)
    if (row.id.startsWith("session:") || row.id.startsWith("recent-session:") || row.id.startsWith("prior-session:") || row.id.startsWith("project-session:")) {
      const sessionID = sessionIDFromRow(row.id)
      const session = sessionID ? allSessionByID().get(sessionID) : undefined
      return session
        ? sessionItem(session, {
            rowID: row.id,
            subtitle: row.parentID === "section:prior-sessions" || row.parentID === "section:sessions" ? projectTitleBySessionID().get(session.id) : undefined,
          })
        : <></>
    }
    if (row.id.startsWith("view:")) {
      const view = (views() ?? []).find((item) => item.id === row.id.slice("view:".length))
      return view ? viewItem(view) : <></>
    }
    if (row.id === "empty:projects") return emptyItem(row.id, "No Projects", "+ Project", () => void createProject())
    if (row.id === "empty:sessions") return emptyItem(row.id, "No Recent Sessions", "+ Session", createBlankSession)
    if (row.id === "empty:views") return emptyItem(row.id, "No Views", "+ View", createView)
    if (row.id.startsWith("empty:project:")) {
      const project = (projects() ?? []).find((item) => item.id === row.id.slice("empty:project:".length))
      return project ? emptyItem(row.id, "No Recent Sessions", "+ Session", () => void createSession(project)) : <></>
    }
    return <></>
  }

  return (
    <Show when={open()}>
      <box
        backgroundColor={SIDEBAR_BACKGROUND}
        width={OPENCODEX_SIDEBAR_WIDTH}
        height="100%"
        flexDirection="column"
        border={["right"]}
        borderColor={theme.border}
      >
        {dashboardItem()}
        <scrollbox
          ref={(scroll) => (sidebarScroll = scroll)}
          flexGrow={1}
          minHeight={0}
          verticalScrollbarOptions={{
            visible: false,
          }}
        >
          <For each={scrollRows()}>{renderSidebarRow}</For>
        </scrollbox>
        <box flexShrink={0} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="column">
          <text fg={sidebarFocused() ? theme.primary : theme.textMuted}>
            {sidebarFocused() ? "Esc" : focusShortcut() || "Ctrl+X F"} {sidebarFocused() ? "main panel" : "focus sidebar"}
          </text>
          <text fg={theme.textMuted}>{toggleShortcut() || "Ctrl+S"} toggle</text>
        </box>
      </box>
    </Show>
  )
}
