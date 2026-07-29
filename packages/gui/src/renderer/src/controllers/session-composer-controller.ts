import type { GuiPromptInfo } from "../lib/prompt-state"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import type { createSessionState } from "./session-state"
import { createPlanModeFollow } from "../lib/plan-mode-follow"
import { activeSessionRouteKey } from "../lib/route-selection"
import { runSessionPromptAction } from "../lib/session-prompt"
import { runShellCommand, runSessionCommand, sendPrompt } from "../lib/store"
import { workbenchPromptTarget } from "../lib/workbench"

export function createSessionComposerController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  selection: ReturnType<typeof createSessionSelectionController>
  state: ReturnType<typeof createSessionState>
  pinSession: (sessionID: string) => void
  rememberModel: (value: string) => void
}) {
  createPlanModeFollow({
    subscribe: input.authoritative.subscribeGlobalEvents,
    activeSessionID: input.selection.activeSessionID,
    setAgent: input.state.setSelectedAgent,
  })
  async function submit(event: SubmitEvent, value?: string | GuiPromptInfo) {
    event.preventDefault()
    const client = input.authoritative.client()
    const route = input.navigation.route()
    if (!input.selection.selectedSession() && route.name === "session") {
      await input.authoritative.ensureSessionCards([route.sessionID])
    }
    const session = input.selection.selectedSession()
    const pinCreatedSession = input.state.pendingPinnedRouteKey() === activeSessionRouteKey(route)
    return runSessionPromptAction({
      gui: client,
      route,
      session,
      text: value ?? input.state.prompt(),
      permissionCount: input.selection.selectedPermissions().length,
      questionCount: input.selection.selectedQuestions().length,
      agent: input.state.selectedAgent(),
      model: input.state.selectedModel(),
      variant: input.state.selectedVariant(),
      setPrompt: input.state.setPrompt,
      setLoadingSessionID: input.authoritative.setLoadingSessionID,
      sendPrompt: (sessionID, text, options) =>
        client ? sendPrompt(client, sessionID, text, options).then(() => undefined) : Promise.resolve(),
      runCommand: (sessionID, command, args, options) =>
        client
          ? runSessionCommand(client, sessionID, { command, arguments: args, ...options }).then(() => undefined)
          : Promise.resolve(),
      runShell: (sessionID, command, options) =>
        client
          ? runShellCommand(client, sessionID, {
              command,
              directory: options.directory,
              agent: options.agent,
              model: options.model,
            }).then(() => undefined)
          : Promise.resolve(),
      serverCommands: input.authoritative.snapshot()?.commands ?? [],
      rememberModel: input.rememberModel,
      markPendingPrompt: input.authoritative.markSessionPromptPending,
      releasePendingPrompt: input.authoritative.releaseSessionPromptPending,
      syncSession: (sessionID) => input.authoritative.syncSession(sessionID, { force: true }),
      refresh: input.authoritative.refresh,
      openCreatedSession: (sessionID, session) => {
        if (pinCreatedSession) input.pinSession(sessionID)
        input.state.setMaterializingSession(session)
        input.state.setMaterializingSessionID(sessionID)
        input.state.setPendingPinnedRouteKey("")
      },
    })
  }

  function openWorkbenchPrompt(text: string) {
    input.state.setPrompt(text)
    const session = input.selection.selectedSession()
    if (session) {
      input.navigation.setRoute({ name: "session", sessionID: session.id })
      input.state.requestComposerFocus()
      return
    }
    const project = input.authoritative.snapshot()?.projects[0]
    input.navigation.setRoute(
      workbenchPromptTarget({
        projectID: project?.id,
        projectDirectory: project?.folders[0]?.path,
        fallbackDirectory: input.authoritative.client()?.directory,
      }),
    )
    input.state.requestComposerFocus()
  }

  return { submit, openWorkbenchPrompt }
}
