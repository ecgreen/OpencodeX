import type { Session } from "@opencode-ai/sdk/v2/client"
import type { Accessor, Setter } from "solid-js"
import type { createDialogController } from "./dialog-controller"
import type { createNavigationController } from "./navigation-controller"
import type { GuiThemeMode } from "../lib/app-preferences"
import { mergeRecentModels } from "../lib/app-session-lists"
import { writeRecentModels } from "../lib/app-preferences"
import type { GuiClient } from "../lib/client"
import { compactPath, formatRelative, title } from "../lib/format"
import {
  runCycleVariantAction,
  runSwitchAgentAction,
  runSwitchModelAction,
  runSwitchVariantAction,
} from "../lib/model-actions"
import type { DiffMode } from "../lib/routes"
import { runMoveSessionAction, sidePanelDirectoryForSession } from "../lib/session-actions"
import { markSessionViewedInSnapshot } from "../lib/session-status"
import {
  abortSession,
  deleteSession,
  loadSessionDiff,
  moveSession,
  renameSession,
  updateSessionUiState,
  type GuiSnapshot,
  type SessionData,
} from "../lib/store"

type TranscriptAction = "first" | "last" | "next" | "previous" | "last-user"

export function createSessionActionsController(input: {
  client: Accessor<GuiClient | undefined>
  snapshot: Accessor<GuiSnapshot | undefined>
  setSnapshot: Setter<GuiSnapshot | undefined>
  navigation: ReturnType<typeof createNavigationController>
  dialogs: ReturnType<typeof createDialogController>
  refresh: () => Promise<void>
  alert: (message: string) => void
  visibleSessions: Accessor<Session[]>
  selectedSession: Accessor<Session | undefined>
  activeSessionData: Accessor<SessionData>
  selectedAgent: Accessor<string>
  setSelectedAgent: Setter<string>
  selectedModel: Accessor<string>
  setSelectedModel: Setter<string>
  selectedVariant: Accessor<string>
  setSelectedVariant: Setter<string>
  recentModels: Accessor<string[]>
  setRecentModels: Setter<string[]>
  setThemeMode: Setter<GuiThemeMode>
  setKeyboardHelpOpen: Setter<boolean>
  chooseProjectID: (projects: GuiSnapshot["projects"]) => Promise<string | undefined>
}) {
  function rememberModel(value: string) {
    const next = mergeRecentModels([value], input.recentModels())
    input.setRecentModels(next)
    writeRecentModels(next)
  }

  function markViewed(sessionID: string, time: number) {
    const client = input.client()
    input.setSnapshot((current) => (current ? markSessionViewedInSnapshot(current, sessionID, time) : current))
    if (client)
      void updateSessionUiState(client, sessionID, { seenAt: time, reviewedAt: time }).catch(() =>
        input.refresh().catch(() => undefined),
      )
  }

  function markReviewed(session: Session) {
    const time = Math.max(Date.now(), session.time.updated)
    const client = input.client()
    input.setSnapshot((current) => (current ? markSessionViewedInSnapshot(current, session.id, time) : current))
    if (client)
      void updateSessionUiState(client, session.id, { seenAt: time, reviewedAt: time }).catch(() =>
        input.refresh().catch(() => undefined),
      )
  }

  async function abort(sessionID: string) {
    const client = input.client()
    const session = input.snapshot()?.sessions.find((item) => item.id === sessionID)
    if (!client) return
    await abortSession(client, sessionID, session?.directory)
    await input.refresh()
  }

  async function rename(session: Session) {
    const client = input.client()
    if (!client) return
    const next = (
      await input.dialogs.askText({
        title: "Edit Session",
        message: "Update the title shown in the sidebar and session list.",
        value: session.title,
      })
    )?.trim()
    if (!next) return
    await renameSession(client, session.id, next, session.directory)
    await input.refresh()
  }

  async function move(session: Session) {
    const client = input.client()
    if (!client) return
    await runMoveSessionAction({
      session,
      projects: input.snapshot()?.projects ?? [],
      alert: input.alert,
      chooseProjectID: input.chooseProjectID,
      confirm: input.dialogs.confirm,
      moveSession: (sessionID, projectID) => moveSession(client, sessionID, projectID).then(() => undefined),
      refresh: input.refresh,
    })
  }

  async function remove(session: Session) {
    const client = input.client()
    if (!client) return
    if (
      !(await input.dialogs.confirm({
        title: "Delete Session",
        message: `Delete "${session.title}"?\n\nThis permanently deletes session data.`,
        confirm: "Delete",
      }))
    )
      return
    await deleteSession(client, session.id)
    await input.refresh()
    input.navigation.setRoute({ name: "dashboard" })
  }

  async function switchSession() {
    const sessions = input.visibleSessions()
    if (sessions.length === 0) return input.alert("No sessions available.")
    const sessionID = await input.dialogs.askChoice({
      title: "Switch Session",
      message: "Choose a session to open.",
      options: sessions.map((session) => ({
        value: session.id,
        title: title(session.title),
        description: compactPath(session.directory),
        meta: formatRelative(session.time.updated),
      })),
    })
    if (sessionID) input.navigation.setRoute({ name: "session", sessionID })
  }

  async function switchModelFor(value: {
    setSelectedModel: (model: string) => void
    setSelectedVariant: (variant: string) => void
  }) {
    await runSwitchModelAction({
      providers: input.snapshot()?.providers ?? [],
      alert: input.alert,
      askChoice: input.dialogs.askChoice,
      setSelectedModel: value.setSelectedModel,
      setSelectedVariant: value.setSelectedVariant,
      rememberModel,
    })
  }

  async function switchAgentFor(setAgent: (agent: string) => void) {
    await runSwitchAgentAction({
      agents: input.snapshot()?.agents ?? [],
      alert: input.alert,
      askChoice: input.dialogs.askChoice,
      setSelectedAgent: setAgent,
    })
  }

  async function switchVariantFor(value: { selectedModel: string; setSelectedVariant: (variant: string) => void }) {
    await runSwitchVariantAction({
      providers: input.snapshot()?.providers ?? [],
      selectedModel: value.selectedModel,
      alert: input.alert,
      askChoice: input.dialogs.askChoice,
      setSelectedVariant: value.setSelectedVariant,
    })
  }

  function cycleVariant() {
    runCycleVariantAction({
      providers: input.snapshot()?.providers ?? [],
      selectedModel: input.selectedModel(),
      selectedVariant: input.selectedVariant(),
      alert: input.alert,
      setSelectedVariant: input.setSelectedVariant,
    })
  }

  async function copyWorkspacePath() {
    const path = input.selectedSession()?.directory || input.client()?.directory
    if (!path) return input.alert("No workspace path available.")
    await navigator.clipboard.writeText(path)
    input.alert("Copied workspace path.")
  }

  function focusComposer() {
    const route = input.navigation.route()
    if (route.name !== "session" && route.name !== "new-session" && input.visibleSessions().length > 0)
      input.navigation.setRoute({ name: "session", sessionID: input.visibleSessions()[0].id })
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
    )
  }

  function moveTranscript(action: TranscriptAction) {
    const transcript = document.querySelector<HTMLElement>(".session-page .transcript")
    const messages = Array.from(document.querySelectorAll<HTMLElement>(".session-page .message[data-message-id]"))
    if (!transcript || messages.length === 0) return
    if (action === "first") return transcript.scrollTo({ top: 0, behavior: "smooth" })
    if (action === "last") return transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" })
    const current = messages.findIndex(
      (message) => message.getBoundingClientRect().bottom > transcript.getBoundingClientRect().top + 12,
    )
    const target =
      action === "last-user"
        ? messages.findLast((message) => message.classList.contains("user"))
        : messages[
            Math.max(0, Math.min(messages.length - 1, (current === -1 ? 0 : current) + (action === "next" ? 1 : -1)))
          ]
    target?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  async function copyLastAssistantMessage() {
    const message = input.activeSessionData().messages.findLast((bundle) => bundle.info.role === "assistant")
    const text = message?.parts
      .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
      .join("\n")
      .trim()
    if (!text) return input.alert("No assistant text is available to copy.")
    await navigator.clipboard.writeText(text)
    input.alert("Assistant message copied.")
  }

  async function switchTheme() {
    const value = await input.dialogs.askChoice({
      title: "Theme",
      options: [
        { value: "dark", title: "Dark", description: "Use the dark GUI palette" },
        { value: "light", title: "Light", description: "Use the light GUI palette" },
      ],
    })
    if (value !== "dark" && value !== "light") return
    input.setThemeMode(value)
    input.alert(`${value === "dark" ? "Dark" : "Light"} mode enabled.`)
  }

  async function loadDiff(value: { mode: DiffMode; session?: Session }) {
    const client = input.client()
    if (!client) return []
    if (value.mode !== "last-turn") return []
    if (!value.session) return []
    return (await loadSessionDiff(client, { sessionID: value.session.id, directory: value.session.directory })).data ?? []
  }

  function sidePanelDirectory(session?: Session) {
    return sidePanelDirectoryForSession({
      session,
      projects: input.snapshot()?.projects ?? [],
      clientDirectory: input.client()?.directory,
    })
  }

  async function updateReviewedFiles(session: Session, reviewedFiles: string[]) {
    const client = input.client()
    if (!client) return
    const reviewedAt =
      reviewedFiles.length > 0 && session.summary?.files === reviewedFiles.length
        ? Math.max(Date.now(), session.time.updated)
        : undefined
    await updateSessionUiState(client, session.id, { reviewedFiles, reviewedAt })
    input.setSnapshot((current) =>
      current
        ? {
            ...current,
            sessionUiState: {
              ...current.sessionUiState,
              [session.id]: {
                sessionID: session.id,
                displayStatus: current.sessionUiState[session.id]?.displayStatus ?? "idle",
                reviewedFiles,
                updated: current.sessionUiState[session.id]?.updated ?? false,
                seenAt: current.sessionUiState[session.id]?.seenAt,
                reviewedAt: reviewedAt ?? current.sessionUiState[session.id]?.reviewedAt,
              },
            },
          }
        : current,
    )
  }

  return {
    rememberModel,
    markViewed,
    markReviewed,
    open: (sessionID: string) => input.navigation.setRoute({ name: "session", sessionID }),
    abort,
    rename,
    move,
    remove,
    switchSession,
    switchModel: () => switchModelFor({ setSelectedModel: input.setSelectedModel, setSelectedVariant: input.setSelectedVariant }),
    switchAgent: () => switchAgentFor(input.setSelectedAgent),
    switchVariant: () =>
      switchVariantFor({ selectedModel: input.selectedModel(), setSelectedVariant: input.setSelectedVariant }),
    switchModelFor,
    switchAgentFor,
    switchVariantFor,
    cycleVariant,
    copyWorkspacePath,
    focusComposer,
    showHelp: () => {
      input.setKeyboardHelpOpen(true)
    },
    moveTranscript,
    copyLastAssistantMessage,
    switchTheme,
    openDiff: (session?: Session) =>
      input.navigation.setRoute({ name: "diff", mode: session ? "last-turn" : "git", sessionID: session?.id }),
    loadDiff,
    sidePanelDirectory,
    updateReviewedFiles,
  }
}
