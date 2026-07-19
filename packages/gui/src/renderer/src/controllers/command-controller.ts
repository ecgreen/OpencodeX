import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { PaletteCommand } from "../components/command-palette"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createCapabilityActionsController } from "./capability-actions-controller"
import type { createDialogController } from "./dialog-controller"
import type { createManagementActionsController } from "./management-actions-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createNoticeController } from "./notice-controller"
import type { createOverlayState } from "./overlay-state"
import type { createPluginController } from "./plugin-controller"
import type { createRailController } from "./rail-controller"
import type { createSessionActionsController } from "./session-actions-controller"
import type { createSessionComposerController } from "./session-composer-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import type { createSessionSlashController } from "./session-slash-controller"
import type { createSessionState } from "./session-state"
import type { createSessionSwitcherController } from "./session-switcher-controller"
import type { createTranscriptPreferences } from "./transcript-preferences"
import type { createViewController } from "./view-controller"
import { createAbortConfirmGate } from "../lib/abort-confirm"
import { guiPluginCommands } from "../lib/gui-plugins"
import { guiShortcutAction, isKeyboardEditingTarget, runGuiShortcutAction } from "../lib/keyboard-shortcuts"
import { selectedModelVariants } from "../lib/model-selection"
import { buildPaletteCommands } from "../lib/palette-commands"
import { abortSessionIDForRoute } from "../lib/route-selection"
import { openSessionWorkspace } from "../lib/session-workspace-bridge"

const ABORT_CONFIRM_WINDOW_MS = 1500

export function createCommandController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  overlays: ReturnType<typeof createOverlayState>
  dialogs: ReturnType<typeof createDialogController>
  notices: ReturnType<typeof createNoticeController>
  rail: ReturnType<typeof createRailController>
  selection: ReturnType<typeof createSessionSelectionController>
  state: ReturnType<typeof createSessionState>
  management: ReturnType<typeof createManagementActionsController>
  sessionActions: ReturnType<typeof createSessionActionsController>
  capabilityActions: ReturnType<typeof createCapabilityActionsController>
  slashController: ReturnType<typeof createSessionSlashController>
  transcriptPreferences: ReturnType<typeof createTranscriptPreferences>
  plugins: ReturnType<typeof createPluginController>
  composer: ReturnType<typeof createSessionComposerController>
  switcher: ReturnType<typeof createSessionSwitcherController>
  view: ReturnType<typeof createViewController>
}) {
  const commands = createMemo<PaletteCommand[]>(() => [
    ...buildPaletteCommands({
      visibleSessionCount: input.selection.visibleSessions().length,
      currentRouteName: input.navigation.route().name,
      workspacePath: input.selection.selectedSession()?.directory || input.authoritative.client()?.directory,
      variantCount: selectedModelVariants(
        input.authoritative.snapshot()?.providers ?? [],
        input.state.selectedModel(),
      ).length,
      actions: {
        switchSession: input.switcher.openSearch,
        createSession: () => input.management.createSession(),
        openRoute: (name) => input.navigation.setRoute({ name }),
        createProject: input.management.createProject,
        createProjectSession: input.management.createProjectSession,
        toggleRail: () => input.rail.setCollapsed((collapsed) => !collapsed),
        focusSidebar: () => {
          input.rail.setCollapsed(false)
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".rail button")?.focus())
        },
        toggleWorkspace,
        openWorkspace,
        createSwarm: () => input.management.createSwarm(),
        createSwarmTask: () =>
          input.capabilityActions.createSwarmTask({
            selectedAgent: input.state.selectedAgent(),
            selectedVariant: input.state.selectedVariant(),
          }),
        createView: input.management.createView,
        editView: input.capabilityActions.editView,
        deleteView: input.capabilityActions.deleteView,
        manageWorkspaces: input.slashController.manageWorkspaces,
        copyWorkspacePath: input.sessionActions.copyWorkspacePath,
        switchModel: input.sessionActions.switchModel,
        switchAgent: input.sessionActions.switchAgent,
        toggleMcps: input.capabilityActions.toggleMcp,
        cycleVariant: input.sessionActions.cycleVariant,
        switchVariant: input.sessionActions.switchVariant,
        connectProvider: input.capabilityActions.connectProvider,
        switchOrg: input.capabilityActions.switchOrg,
        switchTheme: input.sessionActions.switchTheme,
        showHelp: input.sessionActions.showHelp,
        showKeyboardHelp: openKeyboardHelp,
        copyLastAssistantMessage: input.sessionActions.copyLastAssistantMessage,
        copyTranscript: () => input.slashController.copyTranscript(input.selection.selectedSession()),
        toggleCodeConceal: input.transcriptPreferences.handleToggleCodeConcealSlash,
        toggleTimestamps: input.transcriptPreferences.handleToggleTimestampsSlash,
        toggleThinking: input.transcriptPreferences.handleToggleThinkingSlash,
        toggleToolDetails: input.transcriptPreferences.handleToggleToolDetailsSlash,
        toggleScrollbar: input.transcriptPreferences.handleToggleScrollbarSlash,
        toggleGenericToolOutput: input.transcriptPreferences.handleToggleGenericToolOutputSlash,
        transcriptFirst: () => input.sessionActions.moveTranscript("first"),
        transcriptLast: () => input.sessionActions.moveTranscript("last"),
        transcriptNextMessage: () => input.sessionActions.moveTranscript("next"),
        transcriptPreviousMessage: () => input.sessionActions.moveTranscript("previous"),
        transcriptLastUser: () => input.sessionActions.moveTranscript("last-user"),
        focusComposer: input.sessionActions.focusComposer,
        refresh: input.authoritative.refresh,
        installPlugin: () => input.navigation.setRoute({ name: "plugins" }),
        openDocs: () => window.open("https://opencode.ai/docs", "_blank", "noopener,noreferrer"),
        exitApp: () => void window.opencodex?.window("close"),
      },
    }),
    ...guiPluginCommands(input.plugins.plugins()).map(
      ({ plugin, command }): PaletteCommand => ({
        name: `gui-plugin.${plugin.manifest.id}.${command.id}`,
        title: command.title,
        category: "GUI Plugins",
        description: command.description ?? plugin.manifest.name,
        run: () => input.composer.openWorkbenchPrompt(command.prompt),
      }),
    ),
  ])

  const abortGate = createAbortConfirmGate({ windowMs: ABORT_CONFIRM_WINDOW_MS })
  const [abortConfirmSessionID, setAbortConfirmSessionID] = createSignal("")
  let abortConfirmTimer: ReturnType<typeof setTimeout> | undefined

  function requestAbort(sessionID: string) {
    if (abortGate.request(sessionID) === "abort") {
      clearAbortConfirm()
      void input.notices.run(() => input.sessionActions.abort(sessionID))
      return
    }
    setAbortConfirmSessionID(sessionID)
    clearTimeout(abortConfirmTimer)
    abortConfirmTimer = setTimeout(clearAbortConfirm, ABORT_CONFIRM_WINDOW_MS)
  }

  function clearAbortConfirm() {
    setAbortConfirmSessionID("")
    clearTimeout(abortConfirmTimer)
  }

  function openCommandPalette() {
    input.switcher.cancel()
    input.overlays.setCommandPaletteOpen(true)
  }

  function openKeyboardHelp() {
    input.switcher.cancel()
    input.overlays.setKeyboardHelpOpen(true)
  }

  function toggleWorkspace() {
    if (input.navigation.route().name === "views") {
      input.view.toggleSidePanel()
      return
    }
    if (input.navigation.route().name === "session") {
      window.dispatchEvent(new CustomEvent("opencodex:workspace-toggle"))
      return
    }
    const session = input.selection.selectedSession() ?? input.selection.visibleSessions()[0]
    if (!session) return
    input.navigation.setRoute({ name: "session", sessionID: session.id })
    openSessionWorkspace(session.id, { tab: "open" })
  }

  function openWorkspace(target: "context" | "files" | "git" | "terminal" | "web") {
    const panelTarget = target === "git" || target === "context"
      ? { tab: target } as const
      : target === "files"
        ? { tab: "open", value: "opencodex://files" } as const
        : target === "terminal"
          ? { tab: "open", value: "opencodex://terminal" } as const
          : { tab: "open", value: "https://" } as const
    if (input.navigation.route().name === "views") {
      input.view.openSidePanel(undefined, panelTarget)
      return
    }
    if (input.navigation.route().name === "session") {
      window.dispatchEvent(new CustomEvent("opencodex:workspace-open", { detail: panelTarget }))
      return
    }
    const session = input.selection.selectedSession() ?? input.selection.visibleSessions()[0]
    if (!session) return
    input.navigation.setRoute({ name: "session", sessionID: session.id })
    openSessionWorkspace(session.id, panelTarget)
  }

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const sessionID = abortSessionIDForRoute({
        route: input.navigation.route(),
        selectedSessionID: input.selection.selectedSession()?.id,
        focusedViewSessionID: input.view.focusedSessionID(),
        viewSessionIDs: input.view.sessions().map((session) => session.id),
      })
      const status = sessionID ? input.authoritative.snapshot()?.sessionStatus[sessionID]?.type : undefined
      const action = guiShortcutAction(event, {
        editing: isKeyboardEditingTarget(event.target),
        dialogOpen: Boolean(input.dialogs.dialog()) || input.overlays.commandPaletteOpen() || input.overlays.keyboardHelpOpen() || input.switcher.open(),
        sessionSwitcherOpen: input.switcher.open(),
        noticeVisible: Boolean(input.notices.notice()),
        abortableSessionID: sessionID && (status === "busy" || status === "retry") ? sessionID : undefined,
      })
      if (!action) return
      event.preventDefault()
      runGuiShortcutAction(action, {
        abortSession: requestAbort,
        clearNotice: input.notices.clear,
        openCommandPalette,
        toggleRail: () => input.rail.setCollapsed((collapsed) => !collapsed),
        toggleWorkspace,
        focusComposer: () =>
          document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
        createSession: () => void input.notices.run(() => input.management.createSession()),
        refresh: () => void input.notices.run(input.authoritative.refreshAll),
        showKeyboardHelp: openKeyboardHelp,
        copyLastAssistantMessage: () => void input.notices.run(input.sessionActions.copyLastAssistantMessage),
        sessionSwitcher: (direction) => input.switcher.cycle(direction),
        openMruSession: (index) => input.switcher.jumpToIndex(index),
        transcript: input.sessionActions.moveTranscript,
        route: (name) => input.navigation.setRoute({ name }),
      })
    }
    window.addEventListener("keydown", handleKeydown)
    onCleanup(() => window.removeEventListener("keydown", handleKeydown))
  })

  return { commands, abortConfirmSessionID }
}
