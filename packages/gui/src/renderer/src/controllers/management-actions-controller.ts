import type {
  OpencodeXSwarmRoleInput,
  OpencodeXViewMember,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client"
import type { Accessor, Setter } from "solid-js"
import type { createDialogController } from "./dialog-controller"
import type { createClaudeTerminalController } from "./claude-terminal-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createPluginController } from "./plugin-controller"
import type { GuiClient } from "../lib/client"
import { runCreateProjectSessionAction } from "../lib/creation-actions"
import { compactPath, title } from "../lib/format"
import {
  runCreateProjectAction,
  runCreateSessionRouteAction,
  runDeleteProjectAction,
  runEditProjectAction,
} from "../lib/project-actions"
import { activeSessionRouteKey } from "../lib/route-selection"
import { runPermissionAction, sessionDirectoryForRequest } from "../lib/session-actions"
import { createClaudeManagementActions } from "./management-claude-actions"
import {
  approveGoalNode,
  cancelGoal,
  createProject,
  createSwarm,
  createView,
  deleteProject,
  deleteSwarm,
  installPlugin,
  rejectQuestion,
  replyPermission,
  replyQuestion,
  togglePlugin,
  updateProject,
  updateSwarm,
  updateView,
  validateProjectFolders,
  type GuiSnapshot,
} from "../lib/session-api"

export function createManagementActionsController(input: {
  client: Accessor<GuiClient | undefined>
  snapshot: Accessor<GuiSnapshot | undefined>
  navigation: ReturnType<typeof createNavigationController>
  dialogs: ReturnType<typeof createDialogController>
  claudeTerminals: ReturnType<typeof createClaudeTerminalController>
  plugins: ReturnType<typeof createPluginController>
  refresh: () => Promise<void>
  refreshCapabilities: () => Promise<void>
  alert: (message: string) => void
  /** Confirms work that already landed. Optional so tests can omit it. */
  succeed?: (message: string) => void
  setPrompt: Setter<string>
  requestComposerFocus: () => void
  setPendingPinnedSessionRouteKey: Setter<string>
}) {
  const claude = createClaudeManagementActions(input)
  async function permission(request: PermissionRequest, reply: "once" | "always" | "reject") {
    const client = input.client()
    if (!client) return
    await runPermissionAction({
      request,
      reply,
      sessions: input.snapshot()?.sessions ?? [],
      askText: input.dialogs.askText,
      confirm: input.dialogs.confirm,
      replyPermission: (requestID, response, message, directory) =>
        replyPermission(client, requestID, response, message, directory).then(() => undefined),
      refresh: input.refresh,
    })
  }

  async function replyToQuestion(request: QuestionRequest, answers: QuestionAnswer[]) {
    const client = input.client()
    if (!client) return
    await replyQuestion(client, request.id, answers, sessionDirectoryForRequest(input.snapshot()?.sessions ?? [], request))
    await input.refresh()
  }

  async function rejectQuestionRequest(request: QuestionRequest) {
    const client = input.client()
    if (!client) return
    await rejectQuestion(client, request.id, sessionDirectoryForRequest(input.snapshot()?.sessions ?? [], request))
    await input.refresh()
  }

  async function chooseFolder(fallback: string) {
    return window.opencodex?.folder(fallback || undefined)
  }

  async function chooseFolders(fallback: string) {
    if (!window.opencodex?.folders && !window.opencodex?.folder) {
      input.alert("Folder selection is available in the OpencodeX desktop app.")
      return undefined
    }
    const folders = await window.opencodex?.folders?.(fallback || undefined)
    if (folders) return folders
    const folder = await chooseFolder(fallback)
    return folder ? [folder] : undefined
  }

  async function createProjectAction() {
    const client = input.client()
    if (!client) return
    await runCreateProjectAction({
      fallbackDirectory: client.directory,
      chooseFolders,
      askProject: input.dialogs.askProject,
      validateProjectFolders: (folders) => validateProjectFolders(client, { folders }),
      createProject: (name, directory, folders) =>
        createProject(client, { name, directory, folders }).then(() => undefined),
      refresh: input.refresh,
      alert: input.alert,
      succeed: input.succeed,
    })
  }

  async function editProject(projectID: string, currentName: string, folders: string[]) {
    const client = input.client()
    if (!client) return
    await runEditProjectAction({
      projectID,
      currentName,
      folders,
      askProject: input.dialogs.askProject,
      validateProjectFolders: (targetProjectID, next) =>
        validateProjectFolders(client, { projectID: targetProjectID, folders: next }),
      updateProject: (targetProjectID, next) => updateProject(client, targetProjectID, next).then(() => undefined),
      refresh: input.refresh,
      alert: input.alert,
      succeed: input.succeed,
    })
  }

  async function deleteProjectAction(projectID: string, name: string) {
    const client = input.client()
    if (!client) return
    const project = input.snapshot()?.projects.find((item) => item.id === projectID)
    await runDeleteProjectAction({
      projectID,
      name,
      sessionCount: project?.sessionIDs.length ?? 0,
      terminalSessionCount: project?.terminalSessions.length ?? 0,
      confirm: input.dialogs.confirm,
      deleteProject: (targetProjectID) => deleteProject(client, targetProjectID).then(() => undefined),
      refresh: input.refresh,
      succeed: input.succeed,
    })
  }

  function openCreateSessionRoute(projectID?: string, directory?: string) {
    const client = input.client()
    if (!client) return
    return runCreateSessionRouteAction({
      projectID,
      directory,
      projects: input.snapshot()?.projects ?? [],
      guiDirectory: client.directory,
      setPrompt: input.setPrompt,
      openNewSession: (targetProjectID, targetDirectory) =>
        input.navigation.setRoute({ name: "new-session", projectID: targetProjectID, directory: targetDirectory }),
      focusComposer: input.requestComposerFocus,
    })
  }

  async function createPinnedSession() {
    const target = openCreateSessionRoute()
    if (!target) return
    input.setPendingPinnedSessionRouteKey(
      activeSessionRouteKey({ name: "new-session", projectID: target.projectID, directory: target.directory }),
    )
  }

  async function createSwarmAction(projectID?: string) {
    // A swarm is a model, not a project resource - no project required.
    input.navigation.setRoute({ name: "swarm-create", projectID })
  }

  async function saveSwarm(value: {
    projectID?: string
    title?: string
    roles: OpencodeXSwarmRoleInput[]
    swarmID?: string
  }) {
    const client = input.client()
    if (!client) return
    if (value.swarmID) await updateSwarm(client, value.swarmID, { title: value.title, roles: value.roles })
    else await createSwarm(client, { projectID: value.projectID, title: value.title, roles: value.roles })
    await input.refresh()
    // Swarms are models: refresh capabilities so the picker shows them at once.
    await input.refreshCapabilities().catch(() => undefined)
    input.navigation.setRoute({ name: "swarms" })
  }

  async function deleteSwarmAction(swarmID: string, name: string) {
    const client = input.client()
    if (!client) return
    if (
      !(await input.dialogs.confirm({
        title: "Delete Swarm",
        message: `Delete "${name}"? This removes the swarm, roles, tasks, and events.`,
        confirm: "Delete",
      }))
    )
      return
    await deleteSwarm(client, swarmID)
    await input.refresh()
    // Drop the swarm's model-picker entry along with it.
    await input.refreshCapabilities().catch(() => undefined)
    input.navigation.setRoute({ name: "swarms" })
  }

  async function createProjectView(projectID: string, sessionIDs: string[]) {
    const client = input.client()
    const project = input.snapshot()?.projects.find((item) => item.id === projectID)
    if (!client || !project) return
    if (sessionIDs.length === 0) return input.alert("Create a project session before creating a view.")
    const view = await createView(client, {
      title: `${title(project.name ?? project.project.name)} view`,
      sessionIDs: sessionIDs.slice(0, 8),
    }).then((result) => result.data)
    await input.refresh()
    input.navigation.setRoute({ name: "views", viewID: view?.id })
  }

  async function saveView(value: {
    viewID?: string
    title: string
    members: OpencodeXViewMember[]
    metadata?: Record<string, unknown>
  }) {
    const client = input.client()
    if (!client) return
    const current = value.viewID ? input.snapshot()?.views.find((view) => view.id === value.viewID) : undefined
    if (value.viewID && !current) return
    const view = value.viewID
      ? await updateView(client, value.viewID, {
          expectedTimeUpdated: Number(current?.timeUpdated ?? 0),
          title: value.title,
          members: value.members,
          metadata: value.metadata,
        }).then((result) => result.data)
      : await createView(client, { title: value.title, members: value.members, metadata: value.metadata }).then(
          (result) => result.data,
        )
    await input.refresh()
    input.navigation.setRoute({ name: "views", viewID: view?.id ?? value.viewID })
  }

  async function installPluginAction(value: { spec: string; global?: boolean }) {
    const client = input.client()
    if (!client) return
    const result = await installPlugin(client, value)
    if (!result.ok) throw new Error(result.message ?? "Failed to install plugin.")
    await input.refreshCapabilities()
    const targets = [result.server ? "server" : "", result.tui ? "TUI" : ""].filter(Boolean).join(" and ")
    input.alert(`Installed ${value.spec}${targets ? ` for ${targets}` : ""}.`)
  }

  async function togglePluginAction(plugin: NonNullable<GuiSnapshot["plugins"]>[number]) {
    const client = input.client()
    if (!client) return
    await togglePlugin(client, { id: plugin.id, enabled: !plugin.enabled })
    await input.plugins.refresh()
    input.alert(`${plugin.enabled ? "Disabled" : "Enabled"} ${plugin.spec}.`)
  }

  async function chooseProjectID(projects: GuiSnapshot["projects"]) {
    if (projects.length === 1) return projects[0].id
    return input.dialogs.askChoice({
      title: "Choose Project",
      message: "Choose a project to use.",
      options: projects.map((project) => ({
        value: project.id,
        title: title(project.name ?? project.project.name),
        description: project.folders.map((folder) => compactPath(folder.path)).join(", "),
      })),
    })
  }

  async function createProjectSession() {
    await runCreateProjectSessionAction({
      projects: input.snapshot()?.projects ?? [],
      alert: input.alert,
      chooseProjectID,
      createSession: async (projectID, directory) => {
        openCreateSessionRoute(projectID, directory)
      },
    })
  }

  return {
    permission,
    replyToQuestion,
    rejectQuestionRequest,
    createProject: createProjectAction,
    editProject,
    deleteProject: deleteProjectAction,
    createSession: async (projectID?: string, directory?: string) => {
      openCreateSessionRoute(projectID, directory)
    },
    createPinnedSession,
    createSwarm: createSwarmAction,
    approveGoalNode: async (goalID: string, nodeID: string, approved: boolean) => {
      const client = input.client()
      if (!client) return
      await approveGoalNode(client, goalID, nodeID, approved)
      await input.refresh()
    },
    cancelGoal: async (goalID: string) => {
      const client = input.client()
      if (!client) return
      await cancelGoal(client, goalID)
      await input.refresh()
    },
    launchClaudeSession: claude.launchClaudeSession,
    renameClaudeSession: claude.renameClaudeSession,
    moveClaudeSession: claude.moveClaudeSession,
    removeClaudeSession: claude.removeClaudeSession,
    saveSwarm,
    deleteSwarm: deleteSwarmAction,
    createView: async () => input.navigation.setRoute({ name: "view-edit" }),
    createProjectView,
    saveView,
    installPlugin: installPluginAction,
    togglePlugin: togglePluginAction,
    chooseProjectID,
    createProjectSession,
  }
}
