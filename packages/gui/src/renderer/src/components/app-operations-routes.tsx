import { lazy, Show, Suspense } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { EMPTY_SESSION_DATA } from "../controllers/authoritative-state-controller"
import { swarmModelValue } from "../lib/model-selection"
import type { ViewItem } from "../lib/view-items"
import { AppViewPane } from "./app-view-pane"
import { SessionSidePanelLoading } from "./panel-loading-state"

const PluginsPage = lazy(() => import("./plugins-page").then((module) => ({ default: module.PluginsPage })))
const SessionSidePanel = lazy(() =>
  import("./session-side-panel").then((module) => ({ default: module.SessionSidePanel })),
)
const SwarmEditorPage = lazy(() => import("./swarms-page").then((module) => ({ default: module.SwarmEditorPage })))
const SwarmsPage = lazy(() => import("./swarms-page").then((module) => ({ default: module.SwarmsPage })))
const ViewEditorPage = lazy(() =>
  import("./views-manager-page").then((module) => ({ default: module.ViewEditorPage })),
)
const ViewsManagerPage = lazy(() =>
  import("./views-manager-page-entry").then((module) => ({ default: module.ViewsManagerPageEntry })),
)

/** Opens a fresh session with the swarm selected as the model. */
export function startSwarmSession(model: GuiAppModel, swarm: { id: string; projectID?: string }) {
  // The swarm's project, when it has one, is only the session's default home.
  const project = swarm.projectID
    ? model.authoritative.snapshot()?.projects.find((item) => item.id === swarm.projectID)
    : undefined
  model.sessionState.setSelectedModel(swarmModelValue(swarm.id))
  model.sessionState.setSelectedVariant("")
  model.navigation.setRoute({ name: "new-session", projectID: project?.id, directory: project?.folders[0]?.path })
  model.sessionState.requestComposerFocus()
}

export function SwarmsRoute(props: { model: GuiAppModel }) {
  return (
    <SwarmsPage
      snapshot={props.model.authoritative.snapshot()}
      openSwarm={(swarmID) => props.model.navigation.setRoute({ name: "swarm-create", swarmID })}
      createSwarm={() => void props.model.notices.run(() => props.model.management.createSwarm())}
      startSession={(swarm) => startSwarmSession(props.model, swarm)}
    />
  )
}

export function SwarmEditorRoute(props: { model: GuiAppModel }) {
  const route = () => {
    const current = props.model.navigation.route()
    return current.name === "swarm-create" ? current : undefined
  }
  const swarm = () => {
    const current = route()
    return current?.swarmID
      ? props.model.authoritative.snapshot()?.swarms.find((item) => item.id === current.swarmID)
      : undefined
  }
  return (
    <SwarmEditorPage
      providers={props.model.authoritative.snapshot()?.providers ?? []}
      connectedProviderIDs={props.model.authoritative.snapshot()?.connectedProviderIDs ?? []}
      connectProvider={(providerID) => void props.model.notices.run(() => props.model.capabilities.connectProvider(providerID))}
      swarm={swarm()}
      initialProjectID={route()?.projectID}
      recentModels={props.model.sessionState.recentModels()}
      save={(input) => props.model.notices.run(() => props.model.management.saveSwarm(input))}
      cancel={() => props.model.navigation.setRoute({ name: "swarms" })}
      deleteSwarm={(swarmID, name) =>
        void props.model.notices.run(() => props.model.management.deleteSwarm(swarmID, name))
      }
      startSession={(swarm) => startSwarmSession(props.model, swarm)}
    />
  )
}

export function ViewsRoute(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <ViewsManagerPage
      centerCollapsed={model.view.centerCollapsed()}
      centerCollapsible={model.view.centerCollapsible()}
      hideCenter={model.view.toggleViewCenter}
      view={model.view.activeView()}
      views={model.authoritative.snapshot()?.views ?? []}
      snapshot={model.authoritative.snapshot()}
      sessions={model.sessionSelection.visibleSessions()}
      projects={model.authoritative.snapshot()?.projects ?? []}
      items={model.view.items()}
      renderItem={(item) => <AppViewPane model={model} item={item} />}
      sidePanelOpen={model.view.sidePanelOpen()}
      toggleSidePanel={model.view.items().length > 0 ? model.view.toggleSidePanel : undefined}
      sidePanel={
        <Show when={model.view.sidePanelItem()}>
          {(item) => (
            <Suspense fallback={<SessionSidePanelLoading open={model.view.sidePanelOpen()} widthRatio={model.view.sidePanelWidthRatio()} />}>
              <ViewWorkspacePanel model={model} item={item()} />
            </Suspense>
          )}
        </Show>
      }
      openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
      createView={() => void model.notices.run(model.management.createView)}
      editView={(viewID) => model.navigation.setRoute({ name: "view-edit", viewID })}
      deleteView={(viewID, name) => void model.notices.run(() => model.capabilities.deleteViewByID(viewID, name))}
      moveView={(viewID, offset) => void model.notices.run(() => model.rail.moveView(viewID, offset))}
      reorderViews={(viewIDs) => void model.notices.run(() => model.rail.reorderViewIDs(viewIDs))}
      viewPinned={(viewID) => model.rail.pinnedViewIDSet().has(viewID)}
      toggleViewPinned={model.rail.toggleViewPinned}
    />
  )
}

function ViewWorkspacePanel(props: { model: GuiAppModel; item: ViewItem }) {
  const model = props.model
  if (props.item.kind === "session") return (
    <SessionSidePanel
      open={model.view.sidePanelOpen()}
      widthRatio={model.view.sidePanelWidthRatio()}
      session={props.item.session}
      data={model.authoritative.viewSessionData()[props.item.session.id] ?? EMPTY_SESSION_DATA}
      providers={model.authoritative.snapshot()?.providers ?? []}
      mcp={model.authoritative.snapshot()?.mcp ?? {}}
      lsp={model.authoritative.snapshot()?.lsp ?? []}
      config={model.authoritative.snapshot()?.config}
      gui={model.authoritative.client()}
      subscribeGlobalEvents={model.authoritative.subscribeGlobalEvents}
      directory={model.sessionActions.sidePanelDirectory(props.item.session)}
      request={model.view.sidePanelRequest()}
      contextOptions={model.view.sidePanelContextOptions()}
      selectedContextID={props.item.session.id}
      selectContext={model.view.setSidePanelSessionID}
      startResize={model.view.startSidePanelResize}
      toggleMaximized={model.view.toggleSidePanelMaximized}
      resizeByKeyboard={model.view.resizeSidePanelByKeyboard}
    />
  )
  return (
    <SessionSidePanel
      open={model.view.sidePanelOpen()}
      widthRatio={model.view.sidePanelWidthRatio()}
      sessionID={props.item.kind === "terminal" ? props.item.terminalSession.id : props.item.slot.id}
      directory={props.item.kind === "terminal" ? props.item.terminalSession.directory : props.item.slot.directory}
      directoryOnly
      gui={model.authoritative.client()}
      subscribeGlobalEvents={model.authoritative.subscribeGlobalEvents}
      lsp={model.authoritative.snapshot()?.lsp ?? []}
      config={model.authoritative.snapshot()?.config}
      request={model.view.sidePanelRequest()}
      startResize={model.view.startSidePanelResize}
      toggleMaximized={model.view.toggleSidePanelMaximized}
      resizeByKeyboard={model.view.resizeSidePanelByKeyboard}
    />
  )
}

export function ViewEditorRoute(props: { model: GuiAppModel }) {
  const view = () => props.model.view.editingView()
  return (
    <ViewEditorPage
      view={view()}
      sessions={props.model.sessionSelection.visibleSessions()}
      terminalSessions={props.model.authoritative.snapshot()?.terminalSessions ?? []}
      projects={props.model.authoritative.snapshot()?.projects ?? []}
      save={props.model.management.saveView}
      cancel={() =>
        props.model.navigation.setRoute(view() ? { name: "views", viewID: view()!.id } : { name: "views" })
      }
    />
  )
}

export function PluginsRoute(props: { model: GuiAppModel }) {
  return (
    <PluginsPage
      plugins={props.model.authoritative.snapshot()?.plugins ?? []}
      guiPlugins={props.model.plugins.plugins()}
      refresh={() => props.model.notices.run(props.model.plugins.refresh)}
      install={(input) => props.model.notices.run(() => props.model.management.installPlugin(input))}
      toggle={(plugin) => props.model.notices.run(() => props.model.management.togglePlugin(plugin))}
      installGuiPlugin={props.model.plugins.install}
      toggleGuiPlugin={props.model.plugins.toggle}
      removeGuiPlugin={props.model.plugins.remove}
    />
  )
}
