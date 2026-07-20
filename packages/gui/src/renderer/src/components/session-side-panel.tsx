import type { GlobalEvent, LspStatus, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { GuiSnapshot, SessionData } from "../lib/store"
import { Icon } from "./icon"
import { sessionInspectorModel } from "./session-inspector"
import {
  SIDE_PANEL_GIT_VISIBLE_RECHECK_MS,
  createSessionSideGitController,
} from "./session-side-git-controller"
import { SidePanelGitCommitModal } from "./session-side-git-view"
import { readSessionSideContextCollapseState, writeSessionSideContextCollapseState } from "./session-side-context-state"
import type { SessionSidePanelContextOption, SessionSidePanelRequest } from "./session-side-panel-types"
import { SessionSideOpenPanel } from "./session-side-open-panel"

export type { SessionSidePanelContextOption, SessionSidePanelRequest, SessionSidePanelTab, SessionSidePanelTarget } from "./session-side-panel-types"

export function SessionSidePanel(props: {
  open: boolean
  widthRatio: number
  session: Session
  data: SessionData
  providers: Provider[]
  mcp: GuiSnapshot["mcp"]
  lsp: LspStatus[]
  config: GuiSnapshot["config"]
  gui?: GuiClient
  subscribeGlobalEvents?: (listener: (event: GlobalEvent) => void | Promise<void>) => () => void
  directory?: string
  request?: SessionSidePanelRequest
  contextOptions?: SessionSidePanelContextOption[]
  selectedContextID?: string
  selectContext?: (id: string) => void
  startResize: (event: PointerEvent & { currentTarget: HTMLElement }) => void
  toggleMaximized?: () => void
  resizeByKeyboard?: (event: KeyboardEvent) => void
}) {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>(readSessionSideContextCollapseState())
  const [commitModalOpen, setCommitModalOpen] = createSignal(false)
  const [commitPaths, setCommitPaths] = createSignal<string[]>()
  const [gitActiveSessionID, setGitActiveSessionID] = createSignal("")
  const gitTabActive = () => gitActiveSessionID() === props.session.id
  const gitDirectory = createMemo(() => props.directory ?? props.session.directory)
  const git = createSessionSideGitController({
    active: () => props.open && gitTabActive(),
    gui: () => props.gui,
    directory: gitDirectory,
    subscribeGlobalEvents: props.subscribeGlobalEvents,
  })
  const contextModel = createMemo(() => sessionInspectorModel({
    session: props.session,
    data: props.data,
    providers: props.providers,
    mcp: props.mcp ?? {},
    lsp: props.lsp ?? [],
    lspEnabled: props.config?.lsp === undefined ? undefined : props.config.lsp !== false,
  }))

  createEffect(() => {
    if (!props.open || !gitTabActive()) return
    const refresh = () => git.refreshIfStale()
    refresh()
    const interval = window.setInterval(refresh, SIDE_PANEL_GIT_VISIBLE_RECHECK_MS)
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    onCleanup(() => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    })
  })

  createEffect(() => {
    gitDirectory()
    setCommitModalOpen(false)
    setCommitPaths(undefined)
  })

  const toggleContext = (section: string) => {
    setCollapsed((current) => {
      const next = { ...current, [section]: !current[section] }
      writeSessionSideContextCollapseState(next)
      return next
    })
  }

  return (
    <>
      <div
        class="session-side-panel-resize"
        classList={{ open: props.open }}
        role="separator"
        aria-orientation="vertical"
        tabIndex={props.open ? 0 : -1}
        onPointerDown={props.startResize}
        onDblClick={props.toggleMaximized}
        onKeyDown={props.resizeByKeyboard}
        aria-valuemin={28}
        aria-valuemax={70}
        aria-valuenow={Math.round(props.widthRatio * 100)}
        title="Drag to resize. Double-click to maximize or restore."
      >
        <Icon name="panel" />
      </div>
      <aside
        class="session-side-panel"
        classList={{ open: props.open }}
        style={{ "--session-side-panel-width": `${Math.round(props.widthRatio * 10000) / 100}%` }}
        aria-label="Side panel"
        aria-hidden={!props.open}
        inert={!props.open}
      >
        <SessionSideOpenPanel
          sessionID={props.session.id}
          active={props.open}
          gui={props.gui}
          directory={props.directory ?? props.session.directory}
          request={props.request}
          contextModel={contextModel()}
          contextOptions={props.contextOptions}
          selectedContextID={props.selectedContextID}
          selectContext={props.selectContext}
          contextCollapsed={collapsed()}
          toggleContext={toggleContext}
          lsp={props.lsp ?? []}
          lspEnabled={props.config?.lsp === undefined ? undefined : props.config.lsp !== false}
          diffs={props.data.diffs}
          git={git}
          openCommitModal={(path) => {
            setCommitPaths(path ? [path] : undefined)
            setCommitModalOpen(true)
          }}
          gitActiveChange={(state) => setGitActiveSessionID(state.active ? state.sessionID : "")}
        />
      </aside>
      <Show when={commitModalOpen() && git.mode() === "git"}>
        <SidePanelGitCommitModal
          gui={props.gui}
          directory={gitDirectory()}
          branch={git.branch()}
          repository={git.repository()}
          paths={commitPaths()}
          close={() => setCommitModalOpen(false)}
          refresh={git.refresh}
        />
      </Show>
    </>
  )
}
