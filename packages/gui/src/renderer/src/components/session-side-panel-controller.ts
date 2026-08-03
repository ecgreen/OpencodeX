import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { SessionPageProps } from "./session-page-types"
import type { SessionSidePanelRequest, SessionSidePanelTarget } from "./session-side-panel"
import { registerSessionWorkspaceTargetHandler } from "../lib/session-workspace-bridge"
import { createResizeSession } from "../lib/resize-session"
import {
  canCollapseCenter,
  clampWorkspaceWidthRatio,
  EMPTY_WORKSPACE_LAYOUT,
  nextWorkspaceLayout,
  WORKSPACE_WIDTH_MAX,
  WORKSPACE_WIDTH_MIN,
  type WorkspaceLayoutChange,
} from "../lib/workspace-layout"

const SIDE_PANEL_WIDTH_KEY = "opencodex.gui.sessionSidePanel.width"
const sidePanelOpenBySessionID = new Map<string, boolean>()
let pendingSidePanelOpenHandoff: { directory: string; expires: number } | undefined

export function createSessionSidePanelController(props: SessionPageProps) {
  const enabled = () => props.sidePanelEnabled !== false
  // The three columns move together, so they are one value rather than three
  // signals that could disagree - see `workspace-layout` for the rules.
  const [layout, setLayout] = createSignal(
    nextWorkspaceLayout(
      { ...EMPTY_WORKSPACE_LAYOUT, available: enabled() },
      { type: "workspace", open: enabled() && initialSidePanelOpen(props.session) },
    ),
  )
  const open = () => layout().workspaceOpen
  const centerCollapsed = () => layout().centerCollapsed
  const collapsible = () => canCollapseCenter(layout())
  const apply = (change: WorkspaceLayoutChange) => setLayout((current) => nextWorkspaceLayout(current, change))
  const setOpen = (value: boolean) => apply({ type: "workspace", open: value })
  const [mounted, setMounted] = createSignal(open())
  const [widthRatio, setWidthRatio] = createSignal(readSidePanelWidthRatio())
  const [request, setRequest] = createSignal<SessionSidePanelRequest>()
  const session = createMemo(() => enabled() ? props.session : undefined)
  const resizeCleanups = new Set<() => void>()
  let loadedSessionID = props.session?.id ?? ""

  onCleanup(() => resizeCleanups.forEach((cleanup) => cleanup()))

  const toggleFromCommand = () => {
    if (enabled()) toggle()
  }
  const openFromCommand = (event: Event) => {
    if (!enabled() || !(event instanceof CustomEvent)) return
    openTarget(event.detail as SessionSidePanelTarget)
  }
  window.addEventListener("opencodex:workspace-toggle", toggleFromCommand)
  window.addEventListener("opencodex:workspace-open", openFromCommand)
  onCleanup(() => {
    window.removeEventListener("opencodex:workspace-toggle", toggleFromCommand)
    window.removeEventListener("opencodex:workspace-open", openFromCommand)
  })

  createEffect(() => {
    if (open()) setMounted(true)
  })

  // A route that cannot host a workspace also cannot hide the session behind
  // one, so availability is fed in rather than checked at each control.
  createEffect(() => apply({ type: "available", available: enabled() }))

  createEffect(() => {
    if (!enabled()) return
    const sessionID = props.session?.id
    if (!sessionID) return
    const unregister = registerSessionWorkspaceTargetHandler(sessionID, openPanel)
    onCleanup(unregister)
  })

  createEffect(() => {
    if (!enabled()) return
    const id = props.session?.id ?? ""
    if (id === loadedSessionID) return
    const keepPendingPanelOpen = loadedSessionID.startsWith("pending:") && open()
    loadedSessionID = id
    setOpen(id ? keepPendingPanelOpen || initialSidePanelOpen(props.session) : false)
  })

  createEffect(() => {
    if (!enabled()) return
    const id = props.session?.id
    if (id && loadedSessionID === id) writeSidePanelOpen(id, open())
  })

  function openTarget(target: SessionSidePanelTarget = { tab: "git" }) {
    if (props.openSidePanelTarget) {
      props.openSidePanelTarget(target)
      return
    }
    if (!enabled()) return
    openPanel(target)
  }

  function openPanel(target?: SessionSidePanelTarget) {
    setOpen(true)
    if (target) setRequest({ ...target, token: Date.now() } as SessionSidePanelRequest)
  }

  function toggle() {
    if (open()) {
      // Closing takes the session's column back out with it, which is the only
      // reason a reader can never strand themselves in an empty window.
      setOpen(false)
      return
    }
    openPanel()
  }

  function toggleCenter() {
    apply({ type: "toggleCenter" })
  }

  function requestPendingOpenHandoff() {
    pendingSidePanelOpenHandoff = { directory: props.session?.directory ?? "", expires: Date.now() + 30_000 }
  }

  function startResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    resizeCleanups.forEach((cleanup) => cleanup())
    const handle = event.currentTarget
    const pointerID = event.pointerId
    handle.setPointerCapture?.(pointerID)
    window.dispatchEvent(new CustomEvent("opencodex:session-side-panel-resize-start"))
    const container = event.currentTarget.parentElement
    container?.classList.add("resizing")
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth
    const startX = event.clientX
    const startRatio = widthRatio()
    const resize = createResizeSession(startRatio, {
      preview: setWidthRatio,
      persist: writeSidePanelWidthRatio,
    })
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      resize.update(clampWorkspaceWidthRatio(startRatio - ((moveEvent.clientX - startX) / containerWidth)))
    }
    const cleanup = () => {
      if (!resizeCleanups.delete(cleanup)) return
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      if (handle.hasPointerCapture?.(pointerID)) handle.releasePointerCapture?.(pointerID)
      container?.classList.remove("resizing")
      resize.finish()
      window.dispatchEvent(new CustomEvent("opencodex:session-side-panel-resize-end"))
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerID) cleanup()
    }
    resizeCleanups.add(cleanup)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }

  function toggleMaximized() {
    setPersistedWidthRatio(widthRatio() >= WORKSPACE_WIDTH_MAX - 0.02 ? 0.4 : WORKSPACE_WIDTH_MAX)
  }

  function resizeByKeyboard(event: KeyboardEvent) {
    const next = event.key === "ArrowLeft" ? widthRatio() + 0.04
      : event.key === "ArrowRight" ? widthRatio() - 0.04
        : event.key === "Home" ? WORKSPACE_WIDTH_MIN
          : event.key === "End" ? WORKSPACE_WIDTH_MAX
            : undefined
    if (event.key === "Enter") {
      event.preventDefault()
      toggleMaximized()
      return
    }
    if (next === undefined) return
    event.preventDefault()
    setPersistedWidthRatio(next)
  }

  function setPersistedWidthRatio(value: number) {
    const next = clampWorkspaceWidthRatio(value)
    setWidthRatio(next)
    writeSidePanelWidthRatio(next)
  }

  function openTranscriptTarget(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Element)) return
    const gitTarget = target.closest<HTMLElement>("[data-side-panel-git-file]")
    const gitPath = gitTarget?.dataset.sidePanelGitFile
    if (gitPath) {
      event.preventDefault()
      openTarget({ tab: "git", value: gitPath })
      return
    }
    const openTargetElement = target.closest<HTMLElement>("[data-side-panel-open-file]")
    const openPath = openTargetElement?.dataset.sidePanelOpenFile
    if (openPath) {
      event.preventDefault()
      openTarget({ tab: "open", value: openPath })
      return
    }
    const fileTarget = target.closest<HTMLElement>("[data-side-panel-file]")
    const filePath = fileTarget?.dataset.sidePanelFile
    if (filePath) {
      event.preventDefault()
      openTarget({ tab: "open", value: filePath })
      return
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]")
    const href = anchor?.href
    if (!href) return
    if (href.startsWith("http://") || href.startsWith("https://")) {
      event.preventDefault()
      openTarget({ tab: "open", value: href, title: anchor.textContent?.trim() || undefined })
      return
    }
    if (!href.startsWith("file://")) return
    event.preventDefault()
    openTarget({ tab: "open", value: href })
  }

  return {
    enabled,
    open,
    setOpen,
    centerCollapsed,
    collapsible,
    toggleCenter,
    mounted,
    widthRatio,
    request,
    session,
    openTarget,
    toggle,
    requestPendingOpenHandoff,
    startResize,
    toggleMaximized,
    resizeByKeyboard,
    openTranscriptTarget,
  }
}

function readSidePanelOpen(sessionID: string) {
  return sidePanelOpenBySessionID.get(sessionID) ?? false
}

function writeSidePanelOpen(sessionID: string, value: boolean) {
  sidePanelOpenBySessionID.set(sessionID, value)
}

function initialSidePanelOpen(session: Session | undefined) {
  if (!session?.id) return false
  if (takePendingSidePanelOpenHandoff(session)) return true
  if (session.id.startsWith("pending:")) return false
  return readSidePanelOpen(session.id)
}

function takePendingSidePanelOpenHandoff(session: Session | undefined) {
  const handoff = pendingSidePanelOpenHandoff
  if (!handoff) return false
  if (Date.now() > handoff.expires) {
    pendingSidePanelOpenHandoff = undefined
    return false
  }
  if (handoff.directory && session?.directory && handoff.directory !== session.directory) return false
  pendingSidePanelOpenHandoff = undefined
  return true
}

function readSidePanelWidthRatio() {
  if (typeof localStorage === "undefined") return 0.4
  const parsed = Number(localStorage.getItem(SIDE_PANEL_WIDTH_KEY))
  return clampWorkspaceWidthRatio(Number.isFinite(parsed) ? parsed : 0.4)
}

function writeSidePanelWidthRatio(value: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(clampWorkspaceWidthRatio(value)))
}
