import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import type {
  SessionSidePanelContextOption,
  SessionSidePanelRequest,
  SessionSidePanelTarget,
} from "../components/session-side-panel"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createNavigationController } from "./navigation-controller"
import { compactPath, title } from "../lib/format"
import { modelValue } from "../lib/model-selection"
import { projectNameForID, projectNameForSession } from "../lib/project-name"
import type { GuiPromptInfo } from "../lib/prompt-state"
import { activeViewForRoute, focusedViewItemID } from "../lib/route-selection"
import { runShellCommand, runSessionCommand, sendPrompt, updateViewFocus } from "../lib/session-api"
import {
  orderedViewItems,
  viewItemID,
  viewItemsMembershipKey,
  viewSessionsSyncKey,
  type ViewItem,
} from "../lib/view-items"
import { pruneRecordKeys } from "../lib/view-pane-state"
import { viewSessionsInOrder } from "../lib/view-sync"
import { runViewPromptAction } from "../lib/view-prompt"
import {
  canCollapseCenter,
  clampWorkspaceWidthRatio,
  EMPTY_WORKSPACE_LAYOUT,
  nextWorkspaceLayout,
} from "../lib/workspace-layout"
import { createWorkspaceWidth } from "../lib/workspace-width"

const SESSION_VIEWED_MARK_DELAY_MS = 2_000
const VIEW_SIDE_PANEL_WIDTH_KEY = "opencodex.gui.viewSidePanel.width"

export function createViewController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  selectedModel: Accessor<string>
  rememberModel: (value: string) => void
  markSessionViewed: (sessionID: string, time: number) => void
  alert: (message: string) => void
}) {
  const [focusedSessionID, setFocusedSessionID] = createSignal("")
  const [autoStartTerminalID, setAutoStartTerminalID] = createSignal("")
  const [composerFocusRequest, setComposerFocusRequest] = createSignal({ sessionID: "", token: 0 })
  const [sidePanelOpenByViewID, setSidePanelOpenByViewID] = createSignal<Record<string, boolean>>({})
  // The same panel a session has, resized by the same rules - it is the session
  // panel, pointed at whichever session this view is prioritising.
  const width = createWorkspaceWidth({ read: readViewSidePanelWidthRatio, write: writeViewSidePanelWidthRatio })
  const [centerCollapseRequested, setCenterCollapseRequested] = createSignal(false)
  const [sidePanelSessionID, setSidePanelSessionID] = createSignal("")
  const [sidePanelRequest, setSidePanelRequest] = createSignal<SessionSidePanelRequest>()
  const activeView = createMemo(() =>
    activeViewForRoute(input.navigation.route(), input.authoritative.snapshot()?.views ?? []),
  )
  const editingView = createMemo(() => {
    const route = input.navigation.route()
    if (route.name !== "view-edit" || !route.viewID) return undefined
    return input.authoritative.snapshot()?.views.find((view) => view.id === route.viewID)
  })
  const sessions = createMemo(() => viewSessionsInOrder(activeView()).slice(0, 8))
  const items = createMemo<ViewItem[]>(() => orderedViewItems(activeView(), sessions()))
  const loadKey = createMemo(() => {
    const state = input.authoritative.state()
    const key = viewSessionsSyncKey(activeView()?.id, sessions())
    if (!key || state?.phase !== "ready" || !state.epoch || !state.scope) return ""
    return `${state.epoch}:${state.scope.projectID}:${state.scope.workspaceID ?? ""}:${state.scope.directory}:${key}`
  })
  const membershipKey = createMemo(() => viewItemsMembershipKey(activeView()?.id, items()))
  const focusedSession = createMemo(() =>
    focusedViewItemID({
      localID: focusedSessionID(),
      persistedID: activeView()?.focusedItemID ?? activeView()?.focusedSessionID,
      items: items(),
    }),
  )
  const sidePanelOpen = createMemo(() => {
    const id = activeView()?.id
    return id ? (sidePanelOpenByViewID()[id] ?? false) : false
  })
  const sidePanelContextOptions = createMemo<SessionSidePanelContextOption[]>(() =>
    items().map((item) => {
      if (item.kind === "session") return { id: item.session.id, label: title(item.session.title), description: compactPath(item.session.directory) }
      if (item.kind === "terminal") return { id: item.terminalSession.id, label: title(item.terminalSession.title), description: `Claude Code · ${compactPath(item.terminalSession.directory)}` }
      return { id: item.slot.id, label: "New session", description: item.slot.projectLabel ?? compactPath(item.slot.directory) }
    }),
  )
  const sidePanelItem = createMemo(() => {
    const available = items()
    if (available.length === 0) return undefined
    return (
      available.find((item) => viewItemID(item) === sidePanelSessionID()) ??
      available.find((item) => viewItemID(item) === focusedSession()) ??
      available[0]
    )
  })
  const sidePanelSession = createMemo(() => {
    const item = sidePanelItem()
    return item?.kind === "session" ? item.session : undefined
  })
  // The collapse is a request, not the answer: the same rules a session's
  // columns obey decide it, so closing the panel here also brings the view back
  // and no view can be left showing nothing.
  const layout = createMemo(() =>
    nextWorkspaceLayout(
      nextWorkspaceLayout(
        { ...EMPTY_WORKSPACE_LAYOUT, available: Boolean(activeView()) },
        { type: "workspace", open: sidePanelOpen() },
      ),
      { type: "center", collapsed: centerCollapseRequested() },
    ),
  )
  const centerCollapsed = () => layout().centerCollapsed
  const centerCollapsible = () => canCollapseCenter(layout())
  const toggleViewCenter = () => setCenterCollapseRequested(!centerCollapsed())
  let lastMembershipKey = ""
  let composerFocusToken = 0
  let focusPersistTimer: ReturnType<typeof setTimeout> | undefined
  let openedViewID = ""

  createEffect(
    on(
      () => {
        const view = activeView()
        return view ? `${view.id}:${view.timeUpdated}:${view.focusedItemID ?? view.focusedSessionID ?? ""}` : ""
      },
      () => setFocusedSessionID(""),
    ),
  )

  createEffect(() => {
    const route = input.navigation.route()
    const view = activeView()
    if (route.name !== "views" || !view) {
      openedViewID = ""
      setAutoStartTerminalID("")
      return
    }
    if (openedViewID === view.id) return
    openedViewID = view.id
    const focusedID = view.focusedItemID ?? view.focusedSessionID ?? view.members[0]?.id
    setAutoStartTerminalID(view.members.some((member) => member.kind === "terminal" && member.id === focusedID) ? (focusedID ?? "") : "")
  })

  createEffect(() => {
    const route = input.navigation.route()
    const view = activeView()
    if (route.name !== "views" || !view) return
    if (route.viewID !== view.id) input.navigation.setRoute({ name: "views", viewID: view.id }, { replace: true })
    void input.authoritative.ensureSessionCards(view.sessionIDs).catch((cause) => console.error(cause))
  })

  createEffect(() => {
    const route = input.navigation.route()
    const currentLoadKey = loadKey()
    const currentMembershipKey = membershipKey()
    if (route.name !== "views" || !currentLoadKey || !input.authoritative.client()) return
    if (currentMembershipKey !== lastMembershipKey) {
      lastMembershipKey = currentMembershipKey
      input.authoritative.setViewPaneStates((states) => pruneRecordKeys(states, new Set(items().map(viewItemID))))
      input.authoritative.setViewSessionData((data) =>
        pruneRecordKeys(data, new Set(sessions().map((session) => session.id))),
      )
      setFocusedSessionID("")
      setSidePanelSessionID("")
    }
    untrack(() => void input.authoritative.syncViewSessions(sessions(), focusedSession()))
  })

  createEffect(() => {
    if (input.navigation.route().name !== "views") return
    const item = sidePanelItem()
    if (item && sidePanelSessionID() !== viewItemID(item)) setSidePanelSessionID(viewItemID(item))
  })

  createEffect(
    on(
      () => {
        if (input.navigation.route().name !== "views") return ""
        return sessions()
          .map((session) => `${session.id}:${session.time.updated}`)
          .join("\n")
      },
      () => {
        if (input.navigation.route().name !== "views") return
        const timers = sessions().map((session) =>
          setTimeout(
            () => input.markSessionViewed(session.id, Math.max(Date.now(), session.time.updated)),
            SESSION_VIEWED_MARK_DELAY_MS,
          ),
        )
        onCleanup(() => timers.forEach((timer) => clearTimeout(timer)))
      },
    ),
  )

  async function submitPrompt(event: SubmitEvent, item: ViewItem, value: GuiPromptInfo) {
    event.preventDefault()
    const client = input.authoritative.client()
    const paneID = viewItemID(item)
    return runViewPromptAction({
      gui: client,
      item,
      view: activeView(),
      text: value,
      agentForSession: (session) => agentValue(paneID, session),
      modelForSession: (session) => modelValueForPane(paneID, session),
      variantForSession: (session) => variantValue(paneID, session),
      setDraftLoading: input.authoritative.setViewPaneLoading,
      markPendingPrompt: input.authoritative.markSessionPromptPending,
      releasePendingPrompt: input.authoritative.releaseSessionPromptPending,
      setFocusedSessionID,
      alert: input.alert,
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
      syncViewSession: (session) => input.authoritative.syncViewSession(session, { force: true }),
      refresh: input.authoritative.refresh,
    })
  }

  function agentValue(paneID: string, session: Session) {
    return input.authoritative.viewPaneState(paneID).selectedAgent ?? session.agent ?? ""
  }

  function modelValueForPane(paneID: string, session: Session) {
    return (
      input.authoritative.viewPaneState(paneID).selectedModel ??
      (session.model ? modelValue(session.model.providerID, session.model.id) : input.selectedModel())
    )
  }

  function variantValue(paneID: string, session: Session) {
    return input.authoritative.viewPaneState(paneID).selectedVariant ?? session.model?.variant ?? ""
  }

  function focus(sessionID: string, options: { focusComposer?: boolean } = {}) {
    const view = activeView()
    if (!view) return
    setSidePanelSessionID(sessionID)
    if (focusedSession() === sessionID) return
    setFocusedSessionID(sessionID)
    if (options.focusComposer) setComposerFocusRequest({ sessionID, token: ++composerFocusToken })
    scheduleFocusPersistence(view, sessionID)
  }

  function setSidePanelOpen(value: boolean) {
    const id = activeView()?.id
    if (!id) return
    setSidePanelOpenByViewID((current) => (current[id] === value ? current : { ...current, [id]: value }))
  }

  function openSidePanel(sessionID = focusedSession(), target?: SessionSidePanelTarget) {
    const item = items().find((item) => viewItemID(item) === sessionID) ?? sidePanelItem()
    if (item) setSidePanelSessionID(viewItemID(item))
    setSidePanelOpen(true)
    if (target) setSidePanelRequest({ ...target, token: Date.now() } as SessionSidePanelRequest)
  }

  function toggleSidePanel() {
    if (sidePanelOpen()) return setSidePanelOpen(false)
    openSidePanel()
  }

  function projectNameForProjectID(projectID?: string) {
    return projectNameForID(input.authoritative.snapshot()?.projects ?? [], projectID)
  }

  function projectNameForViewSession(session?: Session) {
    return projectNameForSession(input.authoritative.snapshot()?.projects ?? [], session)
  }

  function scheduleFocusPersistence(view: ClientCatalogView, sessionID: string) {
    if (!items().some((item) => viewItemID(item) === sessionID)) return
    if (focusPersistTimer) clearTimeout(focusPersistTimer)
    focusPersistTimer = setTimeout(() => {
      focusPersistTimer = undefined
      const client = input.authoritative.client()
      if (!client) return
      void updateViewFocus(client, view.id, Number(view.timeUpdated), sessionID).catch(() => {
        setFocusedSessionID("")
        void input.authoritative.refresh().catch(() => undefined)
      })
    }, 150)
  }

  onCleanup(() => {
    if (focusPersistTimer) clearTimeout(focusPersistTimer)
  })

  return {
    activeView,
    editingView,
    sessions,
    items,
    focusedSessionID: focusedSession,
    autoStartTerminalID,
    composerFocusRequest,
    sidePanelOpen,
    sidePanelWidthRatio: width.widthRatio,
    centerCollapsed,
    centerCollapsible,
    toggleViewCenter,
    sidePanelSessionID,
    setSidePanelSessionID,
    sidePanelRequest,
    sidePanelContextOptions,
    sidePanelItem,
    sidePanelSession,
    submitPrompt,
    agentValue,
    modelValue: modelValueForPane,
    variantValue,
    focus,
    setSidePanelOpen,
    openSidePanel,
    toggleSidePanel,
    startSidePanelResize: width.startResize,
    toggleSidePanelMaximized: width.toggleMaximized,
    resizeSidePanelByKeyboard: width.resizeByKeyboard,
    projectNameForID: projectNameForProjectID,
    projectNameForSession: projectNameForViewSession,
  }
}

function readViewSidePanelWidthRatio() {
  if (typeof localStorage === "undefined") return 0.4
  const parsed = Number(localStorage.getItem(VIEW_SIDE_PANEL_WIDTH_KEY))
  return clampWorkspaceWidthRatio(Number.isFinite(parsed) ? parsed : 0.4)
}

function writeViewSidePanelWidthRatio(value: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(VIEW_SIDE_PANEL_WIDTH_KEY, String(clampWorkspaceWidthRatio(value)))
}
