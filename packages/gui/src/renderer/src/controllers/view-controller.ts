import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
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
import { runShellCommand, runSessionCommand, sendPrompt, updateViewFocus } from "../lib/store"
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

const SESSION_VIEWED_MARK_DELAY_MS = 2_000

export function createViewController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  selectedModel: Accessor<string>
  rememberModel: (value: string) => void
  markSessionViewed: (sessionID: string, time: number) => void
  alert: (message: string) => void
}) {
  const [focusedSessionID, setFocusedSessionID] = createSignal("")
  const [composerFocusRequest, setComposerFocusRequest] = createSignal({ sessionID: "", token: 0 })
  const [sidePanelOpenByViewID, setSidePanelOpenByViewID] = createSignal<Record<string, boolean>>({})
  const [sidePanelWidthRatio, setSidePanelWidthRatio] = createSignal(0.4)
  const [sidePanelSessionID, setSidePanelSessionID] = createSignal("")
  const [sidePanelRequest, setSidePanelRequest] = createSignal<SessionSidePanelRequest>()
  const activeView = createMemo(() =>
    activeViewForRoute(input.navigation.route(), input.authoritative.snapshot()?.views ?? []),
  )
  const editingView = createMemo(() => {
    const route = input.navigation.route()
    if (route.name !== "view-edit" || !route.viewID) return
    return input.authoritative.snapshot()?.views.find((view) => view.id === route.viewID)
  })
  const sessions = createMemo(() => viewSessionsInOrder(activeView()).slice(0, 8))
  const items = createMemo<ViewItem[]>(() => orderedViewItems(activeView(), sessions()))
  const loadKey = createMemo(() => viewSessionsSyncKey(activeView()?.id, sessions()))
  const membershipKey = createMemo(() => viewItemsMembershipKey(activeView()?.id, items()))
  const focusedSession = createMemo(() =>
    focusedViewItemID({ localID: focusedSessionID(), persistedID: activeView()?.focusedSessionID, items: items() }),
  )
  const sidePanelOpen = createMemo(() => {
    const id = activeView()?.id
    return id ? (sidePanelOpenByViewID()[id] ?? false) : false
  })
  const sidePanelContextOptions = createMemo<SessionSidePanelContextOption[]>(() =>
    sessions().map((session) => ({
      id: session.id,
      label: title(session.title),
      description: compactPath(session.directory),
    })),
  )
  const sidePanelSession = createMemo(() => {
    const available = sessions()
    if (available.length === 0) return
    return (
      available.find((session) => session.id === sidePanelSessionID()) ??
      available.find((session) => session.id === focusedSession()) ??
      available[0]
    )
  })
  let lastMembershipKey = ""
  let composerFocusToken = 0
  let focusPersistTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(
    on(
      () => {
        const view = activeView()
        return view ? `${view.id}:${view.timeUpdated}:${view.focusedSessionID ?? ""}` : ""
      },
      () => setFocusedSessionID(""),
    ),
  )

  createEffect(() => {
    const route = input.navigation.route()
    const view = activeView()
    if (route.name !== "views" || !view) return
    if (route.viewID !== view.id) input.navigation.setRoute({ name: "views", viewID: view.id }, { replace: true })
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
    const session = sidePanelSession()
    if (session && sidePanelSessionID() !== session.id) setSidePanelSessionID(session.id)
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
    await runViewPromptAction({
      gui: client,
      item,
      view: activeView(),
      text: value,
      agentForSession: (session) => agentValue(paneID, session),
      modelForSession: (session) => modelValueForPane(paneID, session),
      variantForSession: (session) => variantValue(paneID, session),
      setDraftLoading: input.authoritative.setViewPaneLoading,
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
    const session = sessions().find((item) => item.id === sessionID) ?? sidePanelSession()
    if (session) setSidePanelSessionID(session.id)
    setSidePanelOpen(true)
    if (target) setSidePanelRequest({ ...target, token: Date.now() } as SessionSidePanelRequest)
  }

  function toggleSidePanel() {
    if (sidePanelOpen()) return setSidePanelOpen(false)
    openSidePanel()
  }

  function startSidePanelResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? window.innerWidth
    const startX = event.clientX
    const startRatio = sidePanelWidthRatio()
    const onMove = (moveEvent: PointerEvent) =>
      setSidePanelWidthRatio(Math.max(0.28, Math.min(0.7, startRatio - (moveEvent.clientX - startX) / width)))
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  function toggleSidePanelMaximized() {
    setSidePanelWidthRatio((current) => current >= 0.68 ? 0.4 : 0.7)
  }

  function resizeSidePanelByKeyboard(event: KeyboardEvent) {
    const next = event.key === "ArrowLeft" ? sidePanelWidthRatio() + 0.04
      : event.key === "ArrowRight" ? sidePanelWidthRatio() - 0.04
        : event.key === "Home" ? 0.28
          : event.key === "End" ? 0.7
            : undefined
    if (event.key === "Enter") {
      event.preventDefault()
      toggleSidePanelMaximized()
      return
    }
    if (next === undefined) return
    event.preventDefault()
    setSidePanelWidthRatio(Math.max(0.28, Math.min(0.7, next)))
  }

  function projectNameForProjectID(projectID?: string) {
    return projectNameForID(input.authoritative.snapshot()?.projects ?? [], projectID)
  }

  function projectNameForViewSession(session?: Session) {
    return projectNameForSession(input.authoritative.snapshot()?.projects ?? [], session)
  }

  function scheduleFocusPersistence(view: OpencodeXView, sessionID: string) {
    if (!sessions().some((session) => session.id === sessionID)) return
    if (focusPersistTimer) clearTimeout(focusPersistTimer)
    focusPersistTimer = setTimeout(() => {
      focusPersistTimer = undefined
      const client = input.authoritative.client()
      if (!client) return
      void updateViewFocus(client, view.id, sessionID).catch(() => {
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
    composerFocusRequest,
    sidePanelOpen,
    sidePanelWidthRatio,
    sidePanelSessionID,
    setSidePanelSessionID,
    sidePanelRequest,
    sidePanelContextOptions,
    sidePanelSession,
    submitPrompt,
    agentValue,
    modelValue: modelValueForPane,
    variantValue,
    focus,
    setSidePanelOpen,
    openSidePanel,
    toggleSidePanel,
    startSidePanelResize,
    toggleSidePanelMaximized,
    resizeSidePanelByKeyboard,
    projectNameForID: projectNameForProjectID,
    projectNameForSession: projectNameForViewSession,
  }
}
