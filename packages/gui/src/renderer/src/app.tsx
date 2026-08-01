import { createEffect, on, onCleanup, untrack } from "solid-js"
import type { GuiAppModel } from "./controllers/app-model"
import { sessionErrorNotice } from "./lib/message-error"
import { createAppearanceController } from "./controllers/appearance-controller"
import { createAuthoritativeStateController } from "./controllers/authoritative-state-controller"
import { createCapabilityActionsController } from "./controllers/capability-actions-controller"
import { createClaudeTerminalController } from "./controllers/claude-terminal-controller"
import { createCommandController } from "./controllers/command-controller"
import { createGuiBridgeController } from "./controllers/gui-bridge-controller"
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
import { createSessionSwitcherController } from "./controllers/session-switcher-controller"
import { createSettingsController } from "./controllers/settings-controller"
import { createSessionGraphController } from "./controllers/session-graph-controller"
import { createSwarmTeamController } from "./controllers/swarm-team-controller"
import { createTranscriptPreferences } from "./controllers/transcript-preferences"
import { createUpdateNoticeController } from "./controllers/update-notice-controller"
import { createViewController } from "./controllers/view-controller"
import { createAttentionNotifications } from "./lib/attention-notifications"
import { AppShell } from "./components/app-shell"

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
  // Turns that fail before any assistant message exists (an unresolvable model,
  // a rejected key) only ever emit this event — without it the session is blank.
  onCleanup(
    authoritative.subscribeGlobalEvents((event) => {
      const message = sessionErrorNotice(event)
      if (message) notices.show(message, "error")
    }),
  )
  const settings = createSettingsController({
    appearance,
    authoritative,
    dialogs,
    transcript: transcriptPreferences,
    alert: notices.alert,
  })
  const updateNotice = createUpdateNoticeController({ authoritative, alert: notices.alert })
  createAttentionNotifications({
    items: authoritative.attentionItems,
    enabled: settings.attentionNotifications,
    // Phase-gated, not `Boolean(state())`: bootstrapping commits carry empty
    // attention items, and a reset drops the phase out of "ready" — both must
    // re-seed the baseline instead of announcing every outstanding item.
    ready: () => authoritative.state()?.phase === "ready",
    isSubagent: (sessionID) => Boolean(authoritative.state()?.sessions.records[sessionID]?.parentID),
    onActivate: (sessionID) => navigation.setRoute({ name: "session", sessionID }),
  })
  const claudeTerminals = createClaudeTerminalController({
    client: authoritative.client,
    refresh: authoritative.refresh,
  })
  const sessionSelection = createSessionSelectionController({ authoritative, navigation, state: sessionState })
  const sessionGraph = createSessionGraphController({ authoritative, selection: sessionSelection })
  // The graph's fetched delegation tree also feeds the team strip: the catalog
  // hides swarm-delegated children, so the strip cannot see them on its own.
  const swarmTeam = createSwarmTeamController({
    authoritative,
    selection: sessionSelection,
    extraChildren: sessionGraph.descendants,
  })
  const plugins = createPluginController({ client: authoritative.client, setSnapshot: authoritative.setSnapshot })
  const rail = createRailController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    visibleSessions: sessionSelection.visibleSessions,
    missingSessionIDs: () => new Set(Object.keys(authoritative.state()?.tombstones.sessions ?? {})),
    ensureSessionCards: authoritative.ensureSessionCards,
    refresh: authoritative.refresh,
  })
  const management = createManagementActionsController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    navigation,
    dialogs,
    claudeTerminals,
    plugins,
    refresh: authoritative.refresh,
    refreshCapabilities: authoritative.refreshCapabilities,
    alert: notices.alert,
    succeed: notices.succeed,
    setPrompt: sessionState.setPrompt,
    requestComposerFocus: sessionState.requestComposerFocus,
    setPendingPinnedSessionRouteKey: sessionState.setPendingPinnedRouteKey,
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
  const sessionSwitcher = createSessionSwitcherController({
    authoritative,
    navigation,
    selection: sessionSelection,
    sessionActions,
  })
  const view = createViewController({
    authoritative,
    navigation,
    selectedModel: sessionState.selectedModel,
    rememberModel: sessionActions.rememberModel,
    markSessionViewed: sessionActions.markViewed,
    alert: notices.alert,
  })
  createGuiBridgeController({ authoritative, navigation, selection: sessionSelection, view })
  const capabilities = createCapabilityActionsController({
    client: authoritative.client,
    snapshot: authoritative.snapshot,
    navigation,
    dialogs,
    refresh: authoritative.refresh,
    refreshCapabilities: authoritative.refreshCapabilities,
    refreshAll: authoritative.refreshAll,
    alert: notices.alert,
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
    switcher: sessionSwitcher,
    view,
  })

  createEffect(() => {
    const route = navigation.route()
    // A swarm session's team view and the workflow graph both ride the
    // view-session hydration: the child session they have opened stays visible
    // so its transcript loads and live-patches. Only one can be open at a time,
    // but both are collected here so neither depends on that staying true.
    const embedded =
      route.name === "session"
        ? [swarmTeam.memberSession(), sessionGraph.nodeSession()].flatMap((session) => (session ? [session] : []))
        : []
    authoritative.setVisibleSessionIDs(
      route.name === "views"
        ? view.sessions().map((session) => session.id)
        : sessionSelection.activeSessionID()
          ? [sessionSelection.activeSessionID(), ...embedded.map((session) => session.id)]
          : [],
    )
    // Untracked: hydration reads the very pane state it then writes (loading
    // flags, loaded timestamps, cached transcripts). Tracking those reads here
    // would subscribe this effect to its own writes, which is how a pane swap
    // turns into a synchronous re-run loop. What this effect must react to is
    // *which* sessions are embedded, and that is read above.
    untrack(() => {
      for (const session of embedded) void authoritative.syncViewSession(session)
    })
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
        sessionActions.markViewed(session.id, Math.max(Date.now(), session.time.updated))
      },
    ),
  )

  const model: GuiAppModel = {
    appearance,
    authoritative,
    capabilities,
    claudeTerminals,
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
    sessionGraph,
    sessionState,
    sessionSwitcher,
    settings,
    swarmTeam,
    transcriptPreferences,
    updateNotice,
    view,
  }
  return <AppShell model={model} />
}
