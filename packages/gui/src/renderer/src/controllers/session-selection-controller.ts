import { createEffect, createMemo, createSignal, untrack } from "solid-js"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createNavigationController } from "./navigation-controller"
import type { createSessionState } from "./session-state"
import {
  emptySessionOrderState,
  reconcileSessionOrderState,
  tuiSidebarSessions,
} from "../lib/app-session-lists"
import { firstAvailableModel, parseModelValue, sessionModelDefaults } from "../lib/model-selection"
import { projectNameForID, projectNameForSession } from "../lib/project-name"
import {
  activeProjectForRoute,
  activeSessionIDForRoute,
  activeSessionRouteKey,
  selectedSessionForRoute,
} from "../lib/route-selection"
import { shouldShowSelectedSessionLoading } from "../lib/session-hydration-policy"
import type { GuiSnapshot } from "../lib/session-api"
import { EMPTY_SESSION_DATA } from "./authoritative-state-controller"

export function createSessionSelectionController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  state: ReturnType<typeof createSessionState>
}) {
  const [orderState, setOrderState] = createSignal(emptySessionOrderState())
  const selectedSession = createMemo(() => {
    const route = input.navigation.route()
    const materializing = input.state.materializingSession()
    if (route.name === "new-session" && materializing) return materializing
    if (route.name === "session" && route.sessionID === materializing?.id) return materializing
    return selectedSessionForRoute(route, input.authoritative.snapshot(), input.authoritative.client()?.directory)
  })
  const activeSessionID = createMemo(() => {
    const route = input.navigation.route()
    const materializing = input.state.materializingSessionID()
    if (route.name === "new-session" && materializing) return materializing
    return activeSessionIDForRoute(route)
  })
  const activeSessionCache = createMemo(() => {
    const sessionID = activeSessionID()
    return sessionID ? input.authoritative.selectedSessionDataCache()[sessionID] : undefined
  })
  const activeSessionData = createMemo(() => {
    const sessionID = activeSessionID()
    if (!sessionID) return EMPTY_SESSION_DATA
    return input.authoritative.sessionDataSessionID() === sessionID
      ? input.authoritative.sessionData()
      : (activeSessionCache()?.data ?? EMPTY_SESSION_DATA)
  })
  const activeSessionLoading = createMemo(() =>
    shouldShowSelectedSessionLoading({
      sessionID: selectedSession() ? activeSessionID() : undefined,
      materializingSessionID: input.state.materializingSessionID(),
      loadedSessionID: input.authoritative.sessionDataSessionID(),
      cachedData: activeSessionCache()?.data,
    }),
  )
  const activeSessionProjectName = createMemo(() => {
    const route = input.navigation.route()
    const projects = input.authoritative.snapshot()?.projects ?? []
    if (route.name === "new-session") return projectNameForID(projects, route.projectID)
    return projectNameForSession(projects, selectedSession())
  })
  const activeProject = createMemo(() =>
    activeProjectForRoute(input.navigation.route(), input.authoritative.snapshot()?.projects ?? []),
  )
  const selectedPermissions = createMemo(() => {
    const session = selectedSession()
    return session
      ? (input.authoritative.snapshot()?.permissions.filter((request) => request.sessionID === session.id) ?? [])
      : []
  })
  const selectedQuestions = createMemo(() => {
    const session = selectedSession()
    return session
      ? (input.authoritative.snapshot()?.questions.filter((request) => request.sessionID === session.id) ?? [])
      : []
  })
  const visibleSessions = createMemo(() => tuiSidebarSessions(input.authoritative.snapshot(), orderState()))
  const authoritativeReady = createMemo(() => input.authoritative.state()?.phase === "ready")

  createEffect(() => setOrderState((state) => reconcileSessionOrderState(state, input.authoritative.snapshot())))

  createEffect(() => {
    const route = input.navigation.route()
    const materializing = input.state.materializingSessionID()
    if (!materializing) return
    if (route.name !== "new-session" && !(route.name === "session" && route.sessionID === materializing)) {
      input.state.setMaterializingSession(undefined)
      input.state.setMaterializingSessionID("")
      return
    }
    if (
      route.name === "session" &&
      (input.authoritative.snapshot()?.sessions ?? []).some((session) => session.id === materializing)
    ) {
      input.state.setMaterializingSession(undefined)
      input.state.setMaterializingSessionID("")
    }
  })

  createEffect(() => {
    const route = input.navigation.route()
    const ready = authoritativeReady()
    if (route.name !== "session" || !input.authoritative.client()) return
    untrack(() =>
      void syncColdLinkedSession({
        ready,
        sessionID: route.sessionID,
        ensureSessionCards: input.authoritative.ensureSessionCards,
        syncSession: input.authoritative.syncSession,
        isCurrent: () => {
          const current = input.navigation.route()
          return current.name === "session" && current.sessionID === route.sessionID
        },
      }).catch((cause) => console.error(cause)),
    )
  })

  createEffect(() => {
    const route = input.navigation.route()
    const state = input.authoritative.state()
    if (route.name !== "session" || state?.phase !== "ready" || !state.tombstones.sessions[route.sessionID]) return
    input.navigation.setRoute({ name: "dashboard" }, { replace: true })
  })

  createEffect(() => {
    if (input.navigation.route().name !== "session") return
    const session = selectedSession()
    if (!session || input.state.selectionSessionID() === session.id) return
    const defaults = sessionModelDefaults(
      session,
      input.state.recentModels(),
      input.authoritative.snapshot()?.providers ?? [],
    )
    input.state.setSelectionSessionID(session.id)
    input.state.setSelectedAgent(defaults.agent)
    input.state.setSelectedModel(defaults.model)
    input.state.setSelectedVariant(defaults.variant)
  })

  createEffect(() => {
    if (input.state.selectedModel()) return
    const providers = input.authoritative.snapshot()?.providers ?? []
    const model = input.state.recentModels().find((item) => modelAvailable(item, providers)) ?? firstAvailableModel(providers)
    if (model) input.state.setSelectedModel(model)
  })

  createEffect(() => {
    const key = input.state.pendingPinnedRouteKey()
    if (key && activeSessionRouteKey(input.navigation.route()) !== key) input.state.setPendingPinnedRouteKey("")
  })

  createEffect(() => {
    const current = input.state.selectedModel()
    if (!current) return
    const providers = input.authoritative.snapshot()?.providers ?? []
    if (modelAvailable(current, providers)) return
    input.state.setSelectedModel(firstAvailableModel(providers) ?? "")
    input.state.setSelectedVariant("")
  })

  return {
    orderState,
    selectedSession,
    activeSessionID,
    activeSessionData,
    activeSessionLoading,
    activeSessionProjectName,
    activeProject,
    selectedPermissions,
    selectedQuestions,
    visibleSessions,
  }
}

function modelAvailable(value: string, providers: GuiSnapshot["providers"]) {
  const selection = parseModelValue(value)
  if (!selection) return false
  return Boolean(providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID])
}

export async function syncColdLinkedSession(input: {
  ready: boolean
  sessionID: string
  ensureSessionCards: (sessionIDs: readonly string[]) => Promise<{ missing: readonly string[] } | undefined>
  syncSession: (sessionID: string) => Promise<void>
  isCurrent: () => boolean
}) {
  if (!input.ready) return false
  const page = await input.ensureSessionCards([input.sessionID])
  if (!input.isCurrent() || page?.missing.includes(input.sessionID)) return false
  await input.syncSession(input.sessionID)
  return true
}
