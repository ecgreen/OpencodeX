import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogSessionRename } from "@tui/component/dialog-session-rename"
import { RGBA } from "@opentui/core"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2"

export const OPENCODEX_SIDEBAR_WIDTH = 36
const KV_KEY = "ox_sidebar_visible"
let refreshOpencodeXSidebarHandler: (() => void) | undefined

export function refreshOpencodeXSidebar() {
  refreshOpencodeXSidebarHandler?.()
}

export function useOxSidebar() {
  const kv = useKV()
  return kv.signal<boolean>(KV_KEY, false)
}

type DerivedStatus = "dormant" | "in_progress" | "input_needed"

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

function deriveStatus(sessionID: string, sync: ReturnType<typeof useSync>): DerivedStatus {
  const permissions = sync.data.permission[sessionID] ?? []
  const questions = sync.data.question[sessionID] ?? []
  if (permissions.length > 0 || questions.length > 0) return "input_needed"
  const status = sync.data.session_status[sessionID]
  if (status?.type === "busy" || status?.type === "retry") return "in_progress"
  return "dormant"
}

function statusColor(status: DerivedStatus) {
  switch (status) {
    case "in_progress":
      return RGBA.fromInts(96, 165, 250, 255)
    case "input_needed":
      return RGBA.fromInts(251, 146, 60, 255)
    case "dormant":
      return RGBA.fromInts(180, 180, 180, 255)
  }
}

function isSessionNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : (JSON.stringify(error) ?? String(error))
  return message.includes("Session not found")
}

function modelLabel(session: Session) {
  const model = session.model?.id ?? ""
  return model.slice(model.lastIndexOf("/") + 1)
}

function titleLabel(value: string, length: number) {
  return value.length > length ? value.slice(0, length - 3) + "..." : value
}

function parseFolders(input: string) {
  return input
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean)
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
  const folders = await DialogPrompt.show(input.dialog, "Project folders", {
    placeholder: "Optional: C:\\repo; D:\\other-repo",
    description: () => <text fg={input.theme.textMuted}>Separate folders with semicolons or new lines.</text>,
  })
  input.dialog.clear()
  if (folders === null) return
  const parsed = parseFolders(folders)
  if (!(await confirmValidFolders({ ...input, folders: parsed }))) return
  await input.sdk
    .request<OpencodeXProjectInfo>("/experimental/opencodex/project", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim() || undefined,
        folders: parsed,
        directory: input.sdk.directory,
      }),
    })
    .then(() => {
      input.refetch?.()
      refreshOpencodeXSidebar()
    })
    .catch((error: Error) => DialogAlert.show(input.dialog, "Project Error", error.message))
}

export async function deleteOpencodeXProjectDialog(input: OpencodeXDialogContext) {
  const projects = await input.sdk
    .request<OpencodeXProjectInfo[]>("/experimental/opencodex/project")
    .catch((error: Error) => {
      void DialogAlert.show(input.dialog, "Delete Project", error.message)
    })
  if (!projects) return
  if (projects.length === 0) {
    await DialogAlert.show(input.dialog, "Delete Project", "There are no projects to delete.")
    return
  }
  const active = (project: OpencodeXProjectInfo) =>
    input.sync ? project.sessions.some((session) => deriveStatus(session.id, input.sync!) !== "dormant") : false
  const sessionCount = (project: OpencodeXProjectInfo) => {
    if (!input.sync) return project.sessions.length
    const sessionIDs = new Set(input.sync.data.session.filter((session) => !session.parentID).map((session) => session.id))
    return project.sessions.filter((session) => sessionIDs.has(session.id)).length
  }
  input.dialog.replace(() => (
    <DialogSelect
      title="Delete project"
      options={projects.map((project) => {
        const count = sessionCount(project)
        return {
          title: project.name ?? project.project.name ?? project.project.worktree,
          value: project.id,
          description: `${project.folders.length} folder${project.folders.length !== 1 ? "s" : ""}, ${count} conversation${count !== 1 ? "s" : ""}${active(project) ? ", active" : ""}`,
          onSelect: (dialog) => {
            dialog.clear()
            void DialogConfirm.show(
              dialog,
              "Delete Project",
              `Delete ${project.name ?? project.project.name ?? project.project.worktree}? Conversations are not deleted.`,
            ).then((confirmed) => {
              if (confirmed !== true) return
              void input.sdk
                .request<boolean>(`/experimental/opencodex/project/${project.id}`, { method: "DELETE" })
                .then(() => {
                  input.refetch?.()
                  refreshOpencodeXSidebar()
                })
                .catch((error: Error) => DialogAlert.show(dialog, "Delete Project", error.message))
            })
          },
        }
      })}
    />
  ))
}

async function createProjectSession(input: OpencodeXDialogContext & { project: OpencodeXProjectInfo }) {
  const directory = input.project.folders[0]?.path ?? input.sdk.directory ?? input.project.project.worktree
  await input.sdk
    .request<Session>("/experimental/opencodex/session", {
      method: "POST",
      body: JSON.stringify({ projectID: input.project.id, directory }),
    })
    .then(async (session) => {
      await input.sync?.session.refresh()
      input.refetch?.()
      refreshOpencodeXSidebar()
      input.route?.navigate({ type: "session", sessionID: session.id })
    })
    .catch((error: Error) => DialogAlert.show(input.dialog, "Session Error", error.message))
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
  const { theme } = useTheme()
  const [toDelete, setToDelete] = createSignal<string>()
  const [refresh, setRefresh] = createSignal(0)
  const [projects, { refetch }] = createResource(refresh, () =>
    sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project"),
  )
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessionMap = createMemo(
    () => new Map(sync.data.session.filter((session) => !session.parentID).map((session) => [session.id, session])),
  )
  const mappedSessionIDs = createMemo(
    () =>
      new Set(
        (projects() ?? []).flatMap((project) =>
          project.sessions.filter((session) => sessionMap().has(session.id)).map((session) => session.id),
        ),
      ),
  )
  const unassigned = createMemo(() =>
    [...sessionMap().values()]
      .filter((session) => !mappedSessionIDs().has(session.id))
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const list = () => {
    setRefresh((value) => value + 1)
    void refetch()
    refreshOpencodeXSidebar()
  }

  function projectLabel(project: OpencodeXProjectInfo) {
    return project.name ?? project.project.name ?? project.project.worktree
  }

  function buildOption(session: Session, category: string) {
    const isDeleting = toDelete() === session.id
    return {
      title: isDeleting ? "Press delete again to confirm" : session.title,
      value: session.id,
      category,
      bg: isDeleting ? theme.error : undefined,
      footer: local.session.isPinned(session.id) ? "pinned" : "",
      gutter: () => <text fg={statusColor(deriveStatus(session.id, sync))}>•</text>,
    }
  }

  const options = createMemo(() => [
    ...(projects() ?? []).flatMap((project) =>
      project.sessions
        .map((session) => sessionMap().get(session.id))
        .filter((session): session is Session => session !== undefined)
        .toSorted((a, b) => b.time.updated - a.time.updated)
        .map((session) => buildOption(session, projectLabel(project))),
    ),
    ...unassigned().map((session) => buildOption(session, "Conversations")),
  ])

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
      current={currentSessionID()}
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: "pin/unpin",
          onTrigger: (option) => {
            local.session.togglePin(option.value)
          },
        },
        {
          command: "session.delete",
          title: "delete",
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              void deleteSession(option.value)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
        {
          command: "opencodex.session.manage",
          title: "move",
          disabled: (projects() ?? []).length === 0,
          onTrigger: (option) => {
            moveSession(option.value)
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
  const { theme } = useTheme()
  const [open] = useOxSidebar()
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [refresh, setRefresh] = createSignal(0)

  const refreshSidebar = () => setRefresh((value) => value + 1)
  refreshOpencodeXSidebarHandler = refreshSidebar
  onCleanup(() => {
    if (refreshOpencodeXSidebarHandler === refreshSidebar) refreshOpencodeXSidebarHandler = undefined
  })

  const [projects, { refetch }] = createResource(refresh, () =>
    sdk.request<OpencodeXProjectInfo[]>("/experimental/opencodex/project"),
  )

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

  const mappedSessionIDs = createMemo(
    () =>
      new Set(
        (projects() ?? []).flatMap((project) =>
          project.sessions.filter((session) => sessionByID().has(session.id)).map((session) => session.id),
        ),
      ),
  )
  const unassigned = createMemo(() => visibleSessions().filter((session) => !mappedSessionIDs().has(session.id)))
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const statusDot = (status: DerivedStatus) => {
    return <text fg={statusColor(status)}>•</text>
  }

  async function createProject() {
    await createOpencodeXProjectDialog({ sdk, dialog, theme, refetch })
  }

  async function editProject(project: OpencodeXProjectInfo) {
    const name = await DialogPrompt.show(dialog, "Project name", {
      placeholder: "Optional display name",
      value: project.name ?? "",
    })
    if (name === null) return
    const folders = await DialogPrompt.show(dialog, "Project folders", {
      value: project.folders.map((folder) => folder.path).join("\n"),
      description: () => <text fg={theme.textMuted}>Separate folders with semicolons or new lines.</text>,
    })
    dialog.clear()
    if (folders === null) return
    const parsed = parseFolders(folders)
    if (!(await confirmValidFolders({ sdk, dialog, theme, refetch, folders: parsed, projectID: project.id }))) return
    await sdk
      .request<OpencodeXProjectInfo>(`/experimental/opencodex/project/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), folders: parsed }),
      })
      .then(() => refetch())
      .catch((error: Error) => DialogAlert.show(dialog, "Project Error", error.message))
  }

  async function createSession(project: OpencodeXProjectInfo) {
    await createProjectSession({ sdk, dialog, theme, route, sync, refetch, project })
  }

  const sessionItem = (session: Session) => {
    const status = createMemo(() => deriveStatus(session.id, sync))
    const active = createMemo(() => currentSessionID() === session.id)

    return (
      <box
        flexShrink={0}
        paddingLeft={2}
        paddingRight={1}
        flexDirection="column"
        backgroundColor={active() ? (theme.backgroundMenu ?? theme.backgroundElement) : undefined}
        onMouseUp={() => {
          route.navigate({ type: "session", sessionID: session.id })
        }}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          {statusDot(status())}
          <text fg={statusColor(status())}>{titleLabel(session.title, 29)}</text>
        </box>
        <Show when={modelLabel(session)}>
          <box flexDirection="row" gap={1} paddingLeft={2}>
            <text fg={statusColor(status())}>{modelLabel(session)}</text>
          </box>
        </Show>
      </box>
    )
  }

  return (
    <Show when={open()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={OPENCODEX_SIDEBAR_WIDTH}
        height="100%"
        flexDirection="column"
        border={["right"]}
        borderColor={theme.border}
      >
        <box flexShrink={0} paddingTop={1} paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
          <text>
            <span style={{ fg: theme.text }}>
              <b>Opencode</b>
            </span>
            <span style={{ fg: theme.warning }}>
              <b>X</b>
            </span>
          </text>
          <text fg={theme.textMuted} onMouseUp={() => void createProject()}>
            + project
          </text>
        </box>
        <box flexShrink={0} paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <text fg={theme.textMuted}>{visibleSessions().length} conversation{visibleSessions().length !== 1 ? "s" : ""}</text>
        </box>
        <scrollbox flexGrow={1}>
          <Show
            when={(projects()?.length ?? 0) > 0 || unassigned().length > 0}
            fallback={
              <box paddingLeft={2} paddingRight={2} paddingTop={1}>
                <text fg={theme.textMuted}>No projects yet</text>
              </box>
            }
          >
            <For each={projects() ?? []}>
              {(project) => {
                const projectSessions = createMemo(() =>
                  project.sessions
                    .filter((session) => !missingSessionIDs().has(session.id))
                    .map((session) => sessionByID().get(session.id))
                    .filter((session): session is Session => session !== undefined),
                )
                const isCollapsed = createMemo(() => collapsed()[project.id] ?? false)
                return (
                  <box flexDirection="column" flexShrink={0} paddingBottom={1}>
                    <box paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
                      <text
                        fg={theme.text}
                        onMouseUp={() => {
                          setCollapsed((state) => ({ ...state, [project.id]: !(state[project.id] ?? false) }))
                        }}
                      >
                        <b>{isCollapsed() ? "▸" : "▾"} {titleLabel(project.name ?? project.project.name ?? project.project.worktree, 20)}</b>
                      </text>
                      <box flexDirection="row" gap={2}>
                        <text
                          fg={theme.textMuted}
                          onMouseDown={(event: { stopPropagation(): void }) => event.stopPropagation()}
                          onMouseUp={(event: { stopPropagation(): void }) => {
                            event.stopPropagation()
                            void editProject(project)
                          }}
                        >
                          ✎
                        </text>
                        <text
                          fg={theme.textMuted}
                          onMouseDown={(event: { stopPropagation(): void }) => event.stopPropagation()}
                          onMouseUp={(event: { stopPropagation(): void }) => {
                            event.stopPropagation()
                            void createSession(project)
                          }}
                        >
                          +
                        </text>
                      </box>
                    </box>
                    <Show
                      when={!isCollapsed() && projectSessions().length > 0}
                      fallback={
                        <Show when={!isCollapsed()}>
                          <box paddingLeft={2} paddingTop={0}>
                            <text fg={theme.textMuted}>No conversations</text>
                          </box>
                        </Show>
                      }
                    >
                      <For each={projectSessions()}>{sessionItem}</For>
                    </Show>
                  </box>
                )
              }}
            </For>
            <Show when={unassigned().length > 0}>
              <box flexDirection="column" flexShrink={0} paddingBottom={1}>
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={theme.text}>
                    <b>Conversations</b>
                  </text>
                </box>
                <For each={unassigned()}>{sessionItem}</For>
              </box>
            </Show>
          </Show>
        </scrollbox>
        <box flexShrink={0} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <text fg={theme.textMuted}>Ctrl+S toggle</text>
        </box>
      </box>
    </Show>
  )
}
