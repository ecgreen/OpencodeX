import type { FileContent, Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, createSignal, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { GuiPromptInfo } from "../lib/prompt-state"
import { runSessionPromptAction } from "../lib/session-prompt"
import {
  createSession,
  loadSession,
  runSessionCommand,
  runShellCommand,
  sendPrompt,
  type SessionData,
} from "../lib/store"
import { EMPTY_VIEW_PANE_RUNTIME_STATE, type ViewPaneRuntimeState } from "../lib/view-pane-state"
import {
  workbenchFileAssistantPrompt,
  workbenchUnsavedBufferDiff,
  type WorkbenchFileBuffer,
  type WorkbenchProjectScope,
} from "../lib/workbench"
import type { WorkbenchPageProps } from "./workbench-page-types"
import { errorText } from "./workbench-page-helpers"

const EMPTY_SESSION_DATA: SessionData = {
  messages: [],
  todos: [],
  diffs: [],
}

export function createWorkbenchAssistantController(input: {
  props: WorkbenchPageProps
  activeGui: Accessor<GuiClient | undefined>
  selectedProject: Accessor<WorkbenchProjectScope | undefined>
  selectedDirectory: Accessor<string>
  activeBuffer: Accessor<WorkbenchFileBuffer<FileContent> | undefined>
  editorSelection: Accessor<string>
  initialSessions: Record<string, string>
  setNotice: (message: string) => void
}) {
  const [sessions, setSessions] = createSignal<Record<string, string>>(input.initialSessions)
  const [sessionCache, setSessionCache] = createSignal<Record<string, Session>>({})
  const [dataBySession, setDataBySession] = createSignal<Record<string, SessionData>>({})
  const [composerState, setComposerState] = createSignal<Record<string, ViewPaneRuntimeState>>({})
  const [loading, setLoading] = createSignal(false)
  const scopeKey = createMemo(() => {
    const project = input.selectedProject()
    if (project?.kind === "project") return `project:${project.projectID}`
    return `workspace:${input.selectedDirectory()}`
  })
  const sessionID = createMemo(() => sessions()[scopeKey()] ?? "")
  const session = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return input.props.snapshot?.sessions.find((item) => item.id === id) ?? sessionCache()[id]
  })
  const data = createMemo(() => {
    const id = sessionID()
    if (!id) return EMPTY_SESSION_DATA
    return dataBySession()[id] ?? EMPTY_SESSION_DATA
  })
  const permissions = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return input.props.snapshot?.permissions.filter((request) => request.sessionID === id) ?? []
  })
  const questions = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return input.props.snapshot?.questions.filter((request) => request.sessionID === id) ?? []
  })
  const composer = createMemo(() => composerState()[scopeKey()] ?? EMPTY_VIEW_PANE_RUNTIME_STATE)

  function updateComposer(update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) {
    const key = scopeKey()
    setComposerState((current) => ({
      ...current,
      [key]: update(current[key] ?? EMPTY_VIEW_PANE_RUNTIME_STATE),
    }))
  }

  function restorePrompt(value: string) {
    updateComposer((state) => ({
      ...state,
      draft: { ...state.draft, input: value },
    }))
  }

  async function ensureSession() {
    const gui = input.activeGui()
    const scope = input.selectedProject()
    const directory = input.selectedDirectory()
    if (!gui || !scope || !directory || loading()) return
    const existing = session()
    if (existing) {
      if (dataBySession()[existing.id]) return
      await load(existing)
      return
    }
    setLoading(true)
    try {
      const created = await createSession(gui, {
        projectID: scope.kind === "project" ? scope.projectID : undefined,
        directory,
        title: `Workbench - ${scope.label}`,
      })
      const nextSession = created.data
      if (!nextSession) return
      setSessions((current) => ({ ...current, [scopeKey()]: nextSession.id }))
      setSessionCache((current) => ({ ...current, [nextSession.id]: nextSession }))
      await load(nextSession)
      await input.props.refresh?.()
    } catch (err) {
      input.setNotice(errorText(err, "Failed to open the Workbench assistant."))
    } finally {
      setLoading(false)
    }
  }

  async function load(session: Session, cursor?: string) {
    const gui = input.activeGui()
    if (!gui) return
    const showLoading = Boolean(cursor) || !dataBySession()[session.id]
    if (showLoading) setLoading(true)
    try {
      const nextData = await loadSession(gui, session.id, session.directory, cursor ? { messageBefore: cursor } : {})
      setDataBySession((current) => ({
        ...current,
        [session.id]: cursor
          ? {
              ...nextData,
              messages: [...nextData.messages, ...(current[session.id]?.messages ?? [])],
              todos: current[session.id]?.todos ?? nextData.todos,
              diffs: current[session.id]?.diffs ?? nextData.diffs,
            }
          : nextData,
      }))
    } catch (err) {
      input.setNotice(errorText(err, "Failed to load the Workbench assistant session."))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  async function submit(event: SubmitEvent, prompt: GuiPromptInfo) {
    const gui = input.activeGui()
    const currentSession = session()
    if (!gui || !currentSession) return
    const buffer = input.activeBuffer()
    const promptWithContext = buffer ? {
      ...prompt,
      input: workbenchFileAssistantPrompt({
        question: prompt.input,
        path: buffer.path,
        content: buffer.content,
        selection: input.editorSelection(),
        dirtyDiff: workbenchUnsavedBufferDiff(buffer),
      }),
    } : prompt
    setLoading(true)
    try {
      await runSessionPromptAction({
        gui,
        route: { name: "session" },
        session: currentSession,
        text: promptWithContext,
        permissionCount: permissions().length,
        questionCount: questions().length,
        agent: input.props.selectedAgent ?? "",
        model: input.props.selectedModel ?? "",
        variant: input.props.selectedVariant ?? "",
        setPrompt: restorePrompt,
        setLoadingSessionID: () => {},
        sendPrompt: (sessionID, text, options) => sendPrompt(gui, sessionID, text, options).then(() => undefined),
        runCommand: (sessionID, command, argumentsText, options) => runSessionCommand(gui, sessionID, {
          command,
          arguments: argumentsText,
          ...options,
        }).then(() => undefined),
        runShell: (sessionID, command, options) => runShellCommand(gui, sessionID, { command, ...options }).then(() => undefined),
        serverCommands: input.props.snapshot?.commands ?? [],
        rememberModel: input.props.rememberModel ?? (() => {}),
        syncSession: async () => {
          await load(currentSession)
        },
        refresh: input.props.refresh ?? (async () => {}),
        openCreatedSession: () => {},
        prepareTarget: async () => ({ target: currentSession }),
      })
    } finally {
      setLoading(false)
    }
  }

  return {
    sessions,
    session,
    data,
    loading,
    permissions,
    questions,
    composer,
    updateComposer,
    restorePrompt,
    ensureSession,
    load,
    submit,
  }
}
