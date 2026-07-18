import type { LspStatus, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { GuiSnapshot, SessionData } from "../lib/store"
import { Icon } from "./icon"
import { sessionInspectorModel } from "./session-inspector"
import {
  SIDE_PANEL_GIT_VISIBLE_RECHECK_MS,
  loadCachedSidePanelGit,
  normalizeSidePanelDiffs,
  refreshSidePanelGitIfStale,
  resourceGitCacheKey,
  sidePanelGitCacheKey,
  sidePanelGitCacheVersions,
  type SidePanelGitResult,
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
  directory?: string
  request?: SessionSidePanelRequest
  contextOptions?: SessionSidePanelContextOption[]
  selectedContextID?: string
  selectContext?: (id: string) => void
  startResize: (event: PointerEvent & { currentTarget: HTMLElement }) => void
  close: () => void
}) {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>(readSessionSideContextCollapseState())
  const [commitModalOpen, setCommitModalOpen] = createSignal(false)
  const gitDirectory = createMemo(() => props.directory ?? props.session.directory)
  const gitCacheKey = createMemo(() => sidePanelGitCacheKey(props.gui, gitDirectory()))
  const gitResourceKey = createMemo(() => `${sidePanelGitCacheVersions()[gitCacheKey()] ?? 0}\u0000${gitCacheKey()}`)
  const [gitResult, { refetch: refetchGit }] = createResource<SidePanelGitResult, string, "force">(gitResourceKey, (key, info) =>
    loadCachedSidePanelGit({ key: resourceGitCacheKey(key), gui: props.gui, directory: gitDirectory() }, info.refetching === "force"),
  )
  const gitFiles = createMemo(() => normalizeSidePanelDiffs(gitResult()?.diff.data ?? []))
  const gitMessage = createMemo(() => gitResult()?.diff.message ?? (gitResult()?.diff.ok === false ? "Unable to load Git diff." : ""))
  const contextModel = createMemo(() => sessionInspectorModel({
    session: props.session,
    data: props.data,
    providers: props.providers,
    mcp: props.mcp ?? {},
    lsp: props.lsp ?? [],
    lspEnabled: props.config?.lsp === undefined ? undefined : props.config.lsp !== false,
  }))

  createEffect(() => {
    if (!props.open) return
    const gui = props.gui
    if (!gui) return
    const key = gitCacheKey()
    const directory = gitDirectory()
    const refresh = () => void refreshSidePanelGitIfStale({ key, gui, directory })
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
          closePanel={props.close}
          contextModel={contextModel()}
          contextOptions={props.contextOptions}
          selectedContextID={props.selectedContextID}
          selectContext={props.selectContext}
          contextCollapsed={collapsed()}
          toggleContext={toggleContext}
          lsp={props.lsp ?? []}
          lspEnabled={props.config?.lsp === undefined ? undefined : props.config.lsp !== false}
          diffs={props.data.diffs}
          gitFiles={gitFiles()}
          gitMessage={gitMessage() || "No project changes."}
          gitLoading={gitResult.loading}
          openCommitModal={() => setCommitModalOpen(true)}
        />
      </aside>
      <Show when={commitModalOpen()}>
        <SidePanelGitCommitModal
          gui={props.gui}
          directory={gitDirectory()}
          status={gitResult()?.status}
          branches={gitResult()?.branches}
          files={gitFiles()}
          close={() => setCommitModalOpen(false)}
          refresh={() => void refetchGit("force")}
        />
      </Show>
    </>
  )
}
