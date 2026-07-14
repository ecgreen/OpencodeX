import type { Session } from "@opencode-ai/sdk/v2/client"
import type { Accessor, Setter } from "solid-js"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createCapabilityActionsController } from "./capability-actions-controller"
import type { createDialogController } from "./dialog-controller"
import type { createManagementActionsController } from "./management-actions-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createSessionActionsController } from "./session-actions-controller"
import type { createTranscriptPreferences } from "./transcript-preferences"
import { parseModelValue, selectedModelVariants } from "../lib/model-selection"
import {
  buildSessionSlashCommands,
  type SessionSlashCommand,
  type SessionSlashCommandContext,
} from "../lib/session-slash-commands"
import { formatSessionTranscript } from "../lib/transcript"
import { defaultTranscriptExportOptions, prepareSessionTranscriptExport } from "../lib/transcript-export"
import {
  abortSession,
  forkSession,
  listWorkspaces,
  removeWorkspace,
  revertSession,
  shareSession,
  summarizeSession,
  syncWorkspaces,
  unrevertSession,
  unshareSession,
  warpSessionWorkspace,
  workspaceStatus,
  type MessageBundle,
  type SessionData,
} from "../lib/store"

export function createSessionSlashController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  dialogs: ReturnType<typeof createDialogController>
  management: ReturnType<typeof createManagementActionsController>
  sessionActions: ReturnType<typeof createSessionActionsController>
  capabilityActions: ReturnType<typeof createCapabilityActionsController>
  transcriptPreferences: ReturnType<typeof createTranscriptPreferences>
  selectedModel: Accessor<string>
  selectedAgent: Accessor<string>
  selectedVariant: Accessor<string>
  activeSessionData: Accessor<SessionData>
  setPrompt: Setter<string>
  alert: (message: string) => void
}) {
  async function manageWorkspaces() {
    const client = input.authoritative.client()
    if (!client) return
    await syncWorkspaces(client).catch(() => undefined)
    const workspaces = (await listWorkspaces(client)).data ?? []
    const statuses = new Map(
      ((await workspaceStatus(client)).data ?? []).map((status) => [status.workspaceID, status.status]),
    )
    if (workspaces.length === 0) return input.alert("No workspaces are available.")
    const value = await input.dialogs.askChoice({
      title: "Manage Workspaces",
      message: "Select a workspace to remove it after confirmation.",
      options: workspaces.map((workspace) => ({
        value: workspace.id,
        title: workspace.name,
        meta: [workspace.type, statuses.get(workspace.id)].filter(Boolean).join(" - "),
        description: [workspace.branch, workspace.directory].filter(Boolean).join(" - "),
      })),
    })
    const workspace = workspaces.find((item) => item.id === value)
    if (!workspace) return
    if (
      !(await input.dialogs.confirm({
        title: "Remove Workspace",
        message: `Remove "${workspace.name}"?`,
        confirm: "Remove",
      }))
    )
      return
    await removeWorkspace(client, workspace.id)
    await input.authoritative.refresh()
    input.alert("Workspace removed.")
  }

  async function warpWorkspace(session?: Session) {
    const client = input.authoritative.client()
    if (!client || !session) return
    await syncWorkspaces(client).catch(() => undefined)
    const workspaces = (await listWorkspaces(client)).data ?? []
    const value = await input.dialogs.askChoice({
      title: "Warp Workspace",
      message: "Move this session into a workspace or detach it to the local project.",
      options: [
        { value: "__local__", title: "Local project", description: "Detach this session from workspace sync" },
        ...workspaces.map((workspace) => ({
          value: workspace.id,
          title: workspace.name,
          meta: workspace.type,
          description: [workspace.branch, workspace.directory].filter(Boolean).join(" - "),
        })),
      ],
    })
    if (!value) return
    const copyChanges = await input.dialogs.askChoice({
      title: "Copy Changes",
      message: "Copy existing workspace changes into the destination?",
      options: [
        { value: "yes", title: "Copy changes", description: "Preserve pending changes during the warp" },
        { value: "no", title: "Do not copy", description: "Move the session without copying changes" },
      ],
    })
    if (!copyChanges) return
    await warpSessionWorkspace(client, {
      id: value === "__local__" ? null : value,
      sessionID: session.id,
      copyChanges: copyChanges === "yes",
    })
    await reloadSession(session)
    input.alert("Session workspace updated.")
  }

  async function share(session?: Session) {
    const client = input.authoritative.client()
    if (!client || !session) return
    const url = session.share?.url ?? (await shareSession(client, session.id)).data?.share?.url
    if (!url) return input.alert("No share URL returned.")
    await navigator.clipboard.writeText(url)
    await input.authoritative.refresh()
    input.alert("Share URL copied.")
  }

  async function unshare(session?: Session) {
    const client = input.authoritative.client()
    if (!client || !session) return
    await unshareSession(client, session.id)
    await input.authoritative.refresh()
    input.alert("Session unshared.")
  }

  async function compact(session?: Session, selectedModel = input.selectedModel()) {
    const client = input.authoritative.client()
    if (!client || !session) return
    const model = parseModelValue(selectedModel)
    if (!model) return input.alert("Select a model before compacting this session.")
    await summarizeSession(client, { sessionID: session.id, providerID: model.providerID, modelID: model.modelID })
    await input.authoritative.refresh()
    input.alert("Session compaction started.")
  }

  async function undo(
    session?: Session,
    data = input.activeSessionData(),
    restorePrompt: (value: string) => void = input.setPrompt,
  ) {
    const client = input.authoritative.client()
    if (!client || !session) return
    const status = input.authoritative.snapshot()?.sessionStatus[session.id]?.type
    if (status && status !== "idle") await abortSession(client, session.id, session.directory).catch(() => undefined)
    const message = data.messages.findLast(
      (item) => (!session.revert?.messageID || item.info.id < session.revert.messageID) && item.info.role === "user",
    )
    if (!message) return input.alert("No previous user message to undo.")
    await revertSession(client, { sessionID: session.id, messageID: message.info.id })
    restorePrompt(message.parts.map(textPartContent).join(""))
    await reloadSession(session)
  }

  async function redo(session?: Session, data = input.activeSessionData()) {
    const client = input.authoritative.client()
    if (!client || !session) return
    const messageID = session.revert?.messageID
    if (!messageID) return input.alert("No message to redo.")
    const message = data.messages.find((item) => item.info.role === "user" && item.info.id > messageID)
    if (!message) await unrevertSession(client, session.id)
    else await revertSession(client, { sessionID: session.id, messageID: message.info.id })
    await reloadSession(session)
  }

  async function fork(session?: Session, data = input.activeSessionData()) {
    const client = input.authoritative.client()
    if (!client || !session) return
    const value = await input.dialogs.askChoice({
      title: "Fork Session",
      message: "Choose where to fork from.",
      options: [
        { value: "__full__", title: "Full session", description: "Fork from the current end of the session" },
        ...userMessageOptions(data),
      ],
    })
    if (!value) return
    const next = (await forkSession(client, { sessionID: session.id, messageID: value === "__full__" ? undefined : value })).data
    if (!next) return input.alert("No forked session returned.")
    if (value !== "__full__") {
      const message = data.messages.find((item) => item.info.id === value)
      input.setPrompt(message?.parts.map(textPartContent).join("") ?? "")
    }
    await input.authoritative.refresh()
    input.navigation.setRoute({ name: "session", sessionID: next.id })
  }

  async function copyTranscript(session?: Session) {
    const transcript = await loadTranscript(session)
    if (!transcript) return
    await navigator.clipboard.writeText(transcript)
    input.alert("Session transcript copied.")
  }

  async function exportTranscript(session?: Session) {
    if (!session) return
    const options = await input.dialogs.askExportOptions({
      title: "Export Options",
      defaults: defaultTranscriptExportOptions({
        session,
        thinking: input.transcriptPreferences.showTranscriptThinking(),
        toolDetails: input.transcriptPreferences.showTranscriptToolDetails(),
        assistantMetadata: true,
      }),
    })
    if (!options) return
    const data = await input.authoritative.loadSession(session.id, { messageLimit: 10_000 })
    const transcript = prepareSessionTranscriptExport({
      session,
      messages: data.messages,
      providers: input.authoritative.snapshot()?.providers ?? [],
      options,
    })
    const href = URL.createObjectURL(new Blob([transcript.markdown], { type: "text/markdown" }))
    if (transcript.openWithoutSaving) {
      const opened = window.open(href, "_blank", "noopener,noreferrer")
      setTimeout(() => URL.revokeObjectURL(href), 30_000)
      if (!opened) input.alert("Export preview was blocked.")
      return
    }
    const link = document.createElement("a")
    link.href = href
    link.download = transcript.filename
    link.click()
    URL.revokeObjectURL(href)
  }

  function commands(
    session?: Session,
    options: {
      data?: SessionData
      selectedModel?: string
      selectedAgent?: string
      selectedVariant?: string
      restorePrompt?: (value: string) => void
      switchModel?: () => void | Promise<void>
      switchAgent?: () => void | Promise<void>
      switchVariant?: () => void | Promise<void>
    } = {},
  ): SessionSlashCommand[] {
    const local = buildSessionSlashCommands({
      shared: !!session?.share?.url,
      canRedo: !!session?.revert?.messageID,
      variantCount: selectedModelVariants(
        input.authoritative.snapshot()?.providers ?? [],
        options.selectedModel ?? input.selectedModel(),
      ).length,
      actions: {
        switchSession: input.sessionActions.switchSession,
        createSession: () => input.management.createSession(),
        openDashboard: () => input.navigation.setRoute({ name: "dashboard" }),
        createProject: input.management.createProject,
        openSwarms: () => input.navigation.setRoute({ name: "swarms" }),
        openSwarm: () => input.navigation.setRoute({ name: "swarms" }),
        createSwarm: () => input.management.createSwarm(),
        createSwarmTask: () =>
          input.capabilityActions.createSwarmTask({
            selectedAgent: options.selectedAgent ?? input.selectedAgent(),
            selectedVariant: options.selectedVariant ?? input.selectedVariant(),
          }),
        openView: () => input.navigation.setRoute({ name: "views" }),
        createView: input.management.createView,
        editView: input.capabilityActions.editView,
        deleteView: input.capabilityActions.deleteView,
        createProjectSession: input.management.createProjectSession,
        manageWorkspaces,
        switchModel: (context) => {
          if (context?.openModelPicker) return context.openModelPicker()
          return (options.switchModel ?? input.sessionActions.switchModel)()
        },
        switchAgent: options.switchAgent ?? input.sessionActions.switchAgent,
        toggleMcps: input.capabilityActions.toggleMcp,
        switchVariant: options.switchVariant ?? input.sessionActions.switchVariant,
        connectProvider: input.capabilityActions.connectProvider,
        switchOrg: input.capabilityActions.switchOrg,
        viewStatus: () => input.navigation.setRoute({ name: "status" }),
        switchTheme: input.sessionActions.switchTheme,
        showHelp: input.sessionActions.showHelp,
        exitApp: () => void window.opencodex?.window("close"),
        openEditor: (context) => input.capabilityActions.editor(session?.directory, context),
        openSkills: input.capabilityActions.skills,
        warpWorkspace: () => warpWorkspace(session),
        openDiff: () => input.sessionActions.openDiff(session),
        shareSession: () => share(session),
        renameSession: () => (session ? input.sessionActions.rename(session) : undefined),
        forkSession: () => fork(session, options.data),
        compactSession: () => compact(session, options.selectedModel),
        unshareSession: () => unshare(session),
        undoMessage: () => undo(session, options.data, options.restorePrompt),
        redoMessage: () => redo(session, options.data),
        toggleCodeConceal: input.transcriptPreferences.handleToggleCodeConcealSlash,
        toggleTimestamps: input.transcriptPreferences.handleToggleTimestampsSlash,
        toggleThinking: input.transcriptPreferences.handleToggleThinkingSlash,
        toggleToolDetails: input.transcriptPreferences.handleToggleToolDetailsSlash,
        toggleScrollbar: input.transcriptPreferences.handleToggleScrollbarSlash,
        toggleGenericToolOutput: input.transcriptPreferences.handleToggleGenericToolOutputSlash,
        copyTranscript: () => copyTranscript(session),
        exportTranscript: () => exportTranscript(session),
      },
    })
    const localNames = new Set(local.flatMap((command) => [command.name, ...(command.aliases ?? [])]))
    const server = (input.authoritative.snapshot()?.commands ?? [])
      .filter((command) => command.source !== "skill" && !localNames.has(command.name))
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(
        (command): SessionSlashCommand => ({
          name: command.name,
          title: command.source === "mcp" ? `${command.name}:mcp` : command.name,
          detail: command.description ?? "Run backend command",
          category: command.source === "mcp" ? "MCP Commands" : "Project Commands",
          run: (context: SessionSlashCommandContext | undefined) => context?.setDraftPrompt(`/${command.name} `),
        }),
      )
    return [...local, ...server]
  }

  return { manageWorkspaces, commands, copyTranscript }

  async function reloadSession(session: Session) {
    await input.authoritative.refresh()
    if (input.authoritative.sessionDataSessionID() === session.id)
      await input.authoritative.syncSession(session.id, { force: true })
    if (input.authoritative.viewSessionData()[session.id])
      await input.authoritative.syncViewSession(session, { force: true })
  }

  async function loadTranscript(session?: Session) {
    if (!session) return
    const data = await input.authoritative.loadSession(session.id, { messageLimit: 10_000 })
    return formatSessionTranscript({
      session,
      messages: data.messages,
      providers: input.authoritative.snapshot()?.providers ?? [],
      options: {
        thinking: input.transcriptPreferences.showTranscriptThinking(),
        toolDetails: input.transcriptPreferences.showTranscriptToolDetails(),
        assistantMetadata: true,
      },
    })
  }

  function userMessageOptions(data: SessionData) {
    return data.messages
      .filter((message) => message.info.role === "user")
      .map((message) => ({
        value: message.info.id,
        title: message.parts.map(textPartContent).join("").replace(/\s+/g, " ").trim() || "User message",
        description: new Date(message.info.time.created).toLocaleString(),
      }))
      .toReversed()
  }

  function textPartContent(part: MessageBundle["parts"][number]) {
    if (part.type !== "text" || part.synthetic || part.ignored) return ""
    return part.text
  }
}
