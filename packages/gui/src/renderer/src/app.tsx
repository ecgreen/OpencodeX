import { createEffect, on, onCleanup } from "solid-js"
import type { GuiAppModel } from "./controllers/app-model"
import { createAppearanceController } from "./controllers/appearance-controller"
import { createAuthoritativeStateController } from "./controllers/authoritative-state-controller"
import { createCapabilityActionsController } from "./controllers/capability-actions-controller"
import { createCommandController } from "./controllers/command-controller"
import { createDialogController } from "./controllers/dialog-controller"
import { createManagementActionsController } from "./controllers/management-actions-controller"
import { createNavigationController } from "./controllers/navigation-controller"
import { createNoticeController } from "./controllers/notice-controller"
import { createOverlayState } from "./controllers/overlay-state"
import { createPluginController } from "./controllers/plugin-controller"
import { createRailController } from "./controllers/rail-controller"
import { createSessionActionsController } from "./controllers/session-actions-controller"
import { createSessionComposerController } from "./controllers/session-composer-controller"
import { createSessionSelectionController } from "./controllers/session-selection-controller"
import { createSessionSlashController } from "./controllers/session-slash-controller"
import { createSessionState } from "./controllers/session-state"
import { createTranscriptPreferences } from "./controllers/transcript-preferences"
import { createViewController } from "./controllers/view-controller"
import { AppShell } from "./components/app-shell"

const SESSION_VIEWED_MARK_DELAY_MS = 2_000

export function App() {
  const navigation = createNavigationController()
  const notices = createNoticeController()
  const dialogs = createDialogController()
  const overlays = createOverlayState()
  const appearance = createAppearanceController()
  const sessionState = createSessionState()
  const transcriptPreferences = createTranscriptPreferences(notices.alert)
  const authoritative = createAuthoritativeStateController({
    route: navigation.route,
    setRoute: navigation.setRoute,
    materializingSession: sessionState.materializingSession,
    materializingSessionID: sessionState.materializingSessionID,
    recentModels: sessionState.recentModels,
    setRecentModels: sessionState.setRecentModels,
  })
  const sessionSelection = createSessionSelectionController({ authoritative, navigation, state: sessionState })
  const plugins = createPluginController({ client: authoritative.client, setSnapshot: authoritative.setSnapshot })
  const rail = createRailController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    visibleSessions: sessionSelection.visibleSessions,
    refresh: authoritative.refresh,
  })
  const management = createManagementActionsController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    navigation,
    dialogs,
    plugins,
    refresh: authoritative.refresh,
    refreshCapabilities: authoritative.refreshCapabilities,
    alert: notices.alert,
    setPrompt: sessionState.setPrompt,
    requestComposerFocus: sessionState.requestComposerFocus,
    setPendingPinnedSessionRouteKey: sessionState.setPendingPinnedRouteKey,
    selectedAgent: sessionState.selectedAgent,
    selectedVariant: sessionState.selectedVariant,
  })
  const sessionActions = createSessionActionsController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    setSnapshot: authoritative.setSnapshot,
    navigation,
    dialogs,
    refresh: authoritative.refresh,
    alert: notices.alert,
    visibleSessions: sessionSelection.visibleSessions,
    selectedSession: sessionSelection.selectedSession,
    activeSessionData: sessionSelection.activeSessionData,
    selectedAgent: sessionState.selectedAgent,
    setSelectedAgent: sessionState.setSelectedAgent,
    selectedModel: sessionState.selectedModel,
    setSelectedModel: sessionState.setSelectedModel,
    selectedVariant: sessionState.selectedVariant,
    setSelectedVariant: sessionState.setSelectedVariant,
    recentModels: sessionState.recentModels,
    setRecentModels: sessionState.setRecentModels,
    setThemeMode: appearance.setThemeMode,
    setKeyboardHelpOpen: overlays.setKeyboardHelpOpen,
    chooseProjectID: management.chooseProjectID,
  })
  const sessionComposer = createSessionComposerController({
    authoritative,
    navigation,
    selection: sessionSelection,
    state: sessionState,
    pinSession: rail.pinSession,
    rememberModel: sessionActions.rememberModel,
  })
  const view = createViewController({
    authoritative,
    navigation,
    selectedModel: sessionState.selectedModel,
    rememberModel: sessionActions.rememberModel,
    markSessionViewed: sessionActions.markViewed,
    alert: notices.alert,
  })
  const capabilities = createCapabilityActionsController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    navigation,
    dialogs,
    refresh: authoritative.refresh,
    refreshCapabilities: authoritative.refreshCapabilities,
    refreshAll: authoritative.refreshAll,
    alert: notices.alert,
    selectedAgent: sessionState.selectedAgent,
  })
  const sessionSlash = createSessionSlashController({
    authoritative,
    navigation,
    dialogs,
    management,
    sessionActions,
    capabilityActions: capabilities,
    transcriptPreferences,
    selectedModel: sessionState.selectedModel,
    selectedAgent: sessionState.selectedAgent,
    selectedVariant: sessionState.selectedVariant,
    activeSessionData: sessionSelection.activeSessionData,
    setPrompt: sessionState.setPrompt,
    alert: notices.alert,
  })
  const commands = createCommandController({
    authoritative,
    navigation,
    overlays,
    dialogs,
    notices,
    rail,
    selection: sessionSelection,
    state: sessionState,
    management,
    sessionActions,
    capabilityActions: capabilities,
    slashController: sessionSlash,
    transcriptPreferences,
    plugins,
    composer: sessionComposer,
  })

  createEffect(() => {
    const route = navigation.route()
    authoritative.setVisibleSessionIDs(
      route.name === "views"
        ? view.sessions().map((session) => session.id)
        : sessionSelection.activeSessionID()
          ? [sessionSelection.activeSessionID()]
          : [],
    )
  })

  createEffect(
    on(
      () => {
        const session = navigation.route().name === "session" ? sessionSelection.selectedSession() : undefined
        return session ? `${session.id}:${session.time.updated}` : ""
      },
      () => {
        const session = navigation.route().name === "session" ? sessionSelection.selectedSession() : undefined
        if (!session) return
        const timer = setTimeout(
          () => sessionActions.markViewed(session.id, Math.max(Date.now(), session.time.updated)),
          SESSION_VIEWED_MARK_DELAY_MS,
        )
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )

  const model: GuiAppModel = {
    appearance,
    authoritative,
    capabilities,
    commands,
    dialogs,
    management,
    navigation,
    notices,
    overlays,
    plugins,
    rail,
    sessionActions,
    sessionComposer,
    sessionSelection,
    sessionSlash,
    sessionState,
    transcriptPreferences,
    view,
  }
  return <AppShell model={model} />
}
