import { lazy, Show } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { EMPTY_SESSION_DATA } from "../controllers/authoritative-state-controller"
import { AppViewPane } from "./app-view-pane"

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
  import("./views-manager-page").then((module) => ({ default: module.ViewsManagerPage })),
)

export function SwarmsRoute(props: { model: GuiAppModel }) {
  const route = props.model.navigation.route()
  return (
    <SwarmsPage
      snapshot={props.model.authoritative.snapshot()}
      swarmID={route.name === "swarms" ? route.swarmID : undefined}
      openSwarm={(swarmID) => props.model.navigation.setRoute({ name: "swarms", swarmID })}
      createSwarm={() => void props.model.notices.run(() => props.model.management.createSwarm())}
      editSwarm={(swarmID) => props.model.navigation.setRoute({ name: "swarm-create", swarmID })}
      openSession={props.model.sessionActions.open}
      assignTask={(swarmID, prompt) =>
        void props.model.notices.run(() => props.model.management.assignSwarmTask(swarmID, prompt))
      }
      cancelSwarm={(swarmID) => void props.model.notices.run(() => props.model.management.cancelSwarm(swarmID))}
      deleteSwarm={(swarmID, name) =>
        void props.model.notices.run(() => props.model.management.deleteSwarm(swarmID, name))
      }
      refresh={() => void props.model.notices.run(props.model.authoritative.refresh)}
    />
  )
}

export function SwarmEditorRoute(props: { model: GuiAppModel }) {
  const route = props.model.navigation.route()
  const swarm =
    route.name === "swarm-create" && route.swarmID
      ? props.model.authoritative.snapshot()?.swarms.find((item) => item.id === route.swarmID)
      : undefined
  return (
    <SwarmEditorPage
      projects={props.model.authoritative.snapshot()?.projects ?? []}
      providers={props.model.authoritative.snapshot()?.providers ?? []}
      connectedProviderIDs={props.model.authoritative.snapshot()?.connectedProviderIDs ?? []}
      agents={props.model.authoritative.snapshot()?.agents ?? []}
      swarm={swarm}
      initialProjectID={route.name === "swarm-create" ? route.projectID : undefined}
      selectedModel={props.model.sessionState.selectedModel()}
      save={(input) => void props.model.notices.run(() => props.model.management.saveSwarm(input))}
      cancel={() =>
        props.model.navigation.setRoute(swarm ? { name: "swarms", swarmID: swarm.id } : { name: "swarms" })
      }
    />
  )
}

export function ViewsRoute(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <ViewsManagerPage
      view={model.view.activeView()}
      views={model.authoritative.snapshot()?.views ?? []}
      snapshot={model.authoritative.snapshot()}
      sessions={model.sessionSelection.visibleSessions()}
      projects={model.authoritative.snapshot()?.projects ?? []}
      items={model.view.items()}
      renderItem={(item) => <AppViewPane model={model} item={item} />}
      sidePanelOpen={model.view.sidePanelOpen()}
      toggleSidePanel={model.view.sessions().length > 0 ? model.view.toggleSidePanel : undefined}
      sidePanel={
        <Show when={model.view.sidePanelSession()}>
          {(session) => (
            <SessionSidePanel
              open={model.view.sidePanelOpen()}
              widthRatio={model.view.sidePanelWidthRatio()}
              session={session()}
              data={model.authoritative.viewSessionData()[session().id] ?? EMPTY_SESSION_DATA}
              providers={model.authoritative.snapshot()?.providers ?? []}
              mcp={model.authoritative.snapshot()?.mcp ?? {}}
              lsp={model.authoritative.snapshot()?.lsp ?? []}
              config={model.authoritative.snapshot()?.config}
              gui={model.authoritative.client()}
              directory={model.sessionActions.sidePanelDirectory(session())}
              request={model.view.sidePanelRequest()}
              contextOptions={model.view.sidePanelContextOptions()}
              selectedContextID={session().id}
              selectContext={model.view.setSidePanelSessionID}
              startResize={model.view.startSidePanelResize}
              close={() => model.view.setSidePanelOpen(false)}
            />
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

export function ViewEditorRoute(props: { model: GuiAppModel }) {
  const view = () => props.model.view.editingView()
  return (
    <ViewEditorPage
      view={view()}
      sessions={props.model.sessionSelection.visibleSessions()}
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
