import { createMemo, onCleanup, onMount } from "solid-js"
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
import type { createTranscriptPreferences } from "./transcript-preferences"
import { guiPluginCommands } from "../lib/gui-plugins"
import { guiShortcutAction, isKeyboardEditingTarget, runGuiShortcutAction } from "../lib/keyboard-shortcuts"
import { selectedModelVariants } from "../lib/model-selection"
import { buildPaletteCommands } from "../lib/palette-commands"

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
        switchSession: input.sessionActions.switchSession,
        createSession: () => input.management.createSession(),
        openRoute: (name) => input.navigation.setRoute({ name }),
        createProject: input.management.createProject,
        createProjectSession: input.management.createProjectSession,
        toggleRail: () => input.rail.setCollapsed((collapsed) => !collapsed),
        focusSidebar: () => {
          input.rail.setCollapsed(false)
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".rail button")?.focus())
        },
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
        showKeyboardHelp: () => {
          input.overlays.setKeyboardHelpOpen(true)
        },
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

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const session = input.selection.selectedSession()
      const status = session ? input.authoritative.snapshot()?.sessionStatus[session.id]?.type : undefined
      const action = guiShortcutAction(event, {
        editing: isKeyboardEditingTarget(event.target),
        dialogOpen: Boolean(input.dialogs.dialog()),
        noticeVisible: Boolean(input.notices.notice()),
        abortableSessionID: session && (status === "busy" || status === "retry") ? session.id : undefined,
      })
      if (!action) return
      event.preventDefault()
      runGuiShortcutAction(action, {
        abortSession: (sessionID) => void input.notices.run(() => input.sessionActions.abort(sessionID)),
        clearNotice: input.notices.clear,
        openCommandPalette: () => input.overlays.setCommandPaletteOpen(true),
        toggleRail: () => input.rail.setCollapsed((collapsed) => !collapsed),
        focusComposer: () =>
          document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
        createSession: () => void input.notices.run(() => input.management.createSession()),
        refresh: () => void input.notices.run(input.authoritative.refreshAll),
        showKeyboardHelp: () => input.overlays.setKeyboardHelpOpen(true),
        copyLastAssistantMessage: () => void input.notices.run(input.sessionActions.copyLastAssistantMessage),
        transcript: input.sessionActions.moveTranscript,
        route: (name) => input.navigation.setRoute({ name }),
      })
    }
    window.addEventListener("keydown", handleKeydown)
    onCleanup(() => window.removeEventListener("keydown", handleKeydown))
  })

  return { commands }
}
