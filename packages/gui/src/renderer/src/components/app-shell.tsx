import { Button } from "./ui"
import { Show, Suspense } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { NAV_ITEMS } from "../controllers/navigation-controller"
import { guiPluginThemeCss } from "../lib/gui-plugins"
import { projectSessions } from "../lib/app-session-lists"
import { AppLoadingSkeleton } from "./app-loading"
import { AppRoutes } from "./app-routes"
import { Titlebar } from "./chrome"
import { CommandPaletteModal } from "./command-palette"
import { DialogModal } from "./dialog-modal"
import { KeyboardHelpModal } from "./keyboard-help"
import { RailSidebar } from "./rail-sidebar"

export function AppShell(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <div class="app-shell" classList={{ "rail-collapsed": model.rail.collapsed() }}>
      <style>{guiPluginThemeCss(model.plugins.plugins())}</style>
      <Titlebar
        canGoBack={model.navigation.canGoBack()}
        canGoForward={model.navigation.canGoForward()}
        goBack={model.navigation.goBack}
        goForward={model.navigation.goForward}
        newSession={() => void model.notices.run(() => model.management.createSession())}
        newProject={() => void model.notices.run(model.management.createProject)}
        newView={() => void model.notices.run(model.management.createView)}
        newSwarm={() => void model.notices.run(() => model.management.createSwarm())}
        openDashboard={() => model.navigation.setRoute({ name: "dashboard" })}
        openProjects={() => model.navigation.setRoute({ name: "projects" })}
        openSessions={() => model.navigation.setRoute({ name: "sessions" })}
        openSwarms={() => model.navigation.setRoute({ name: "swarms" })}
        openViews={() => model.navigation.setRoute({ name: "views" })}
        openWorkbench={() => model.navigation.setRoute({ name: "workbench" })}
        toggleLeftSidebar={() => model.rail.setCollapsed((collapsed) => !collapsed)}
        toggleViewSidePanel={model.view.sessions().length > 0 ? model.view.toggleSidePanel : undefined}
        openCommandPalette={() => model.overlays.setCommandPaletteOpen(true)}
        openKeyboardHelp={() => model.overlays.setKeyboardHelpOpen(true)}
      />
      <RailSidebar
        snapshot={model.authoritative.snapshot()}
        sessions={model.sessionSelection.visibleSessions()}
        pinnedSessions={model.rail.pinnedSessions()}
        pinnedViews={model.rail.pinnedViews()}
        navItems={NAV_ITEMS}
        activeRouteName={model.navigation.route().name}
        activeSessionID={model.sessionSelection.activeSessionID()}
        activeViewID={model.view.activeView()?.id}
        railCollapsed={model.rail.collapsed()}
        railSectionOrder={model.rail.sectionOrder()}
        railSections={model.rail.sections()}
        dragTarget={model.rail.dragTarget()}
        dropTarget={model.rail.dropTarget()}
        projectVisualOrder={model.rail.projectVisualOrder()}
        projectSessions={(project) =>
          projectSessions(project, model.authoritative.snapshot(), model.sessionSelection.orderState())
        }
        projectExpanded={model.rail.projectExpanded}
        sessionPinned={(sessionID) => model.rail.pinnedSessionIDSet().has(sessionID)}
        viewPinned={(viewID) => model.rail.pinnedViewIDSet().has(viewID)}
        toggleRail={() => model.rail.setCollapsed((collapsed) => !collapsed)}
        toggleRailSection={model.rail.toggleSection}
        toggleProject={model.rail.toggleProject}
        openDashboard={() => model.navigation.setRoute({ name: "dashboard" })}
        openRoute={(name) => model.navigation.setRoute({ name })}
        openSession={model.sessionActions.open}
        openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
        createProject={() => void model.notices.run(model.management.createProject)}
        createSession={(projectID, directory) =>
          void model.notices.run(() => model.management.createSession(projectID, directory))
        }
        createPinnedSession={() => void model.notices.run(model.management.createPinnedSession)}
        createView={() => void model.notices.run(model.management.createView)}
        toggleSessionPinned={model.rail.toggleSessionPinned}
        toggleViewPinned={model.rail.toggleViewPinned}
        renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
        deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
        editView={(viewID) => model.navigation.setRoute({ name: "view-edit", viewID })}
        deleteView={(viewID, name) => void model.notices.run(() => model.capabilities.deleteViewByID(viewID, name))}
        startDrag={model.rail.startDrag}
        dragOver={model.rail.dragOver}
        clearDragTarget={model.rail.clearDragTarget}
        sectionPointerDrag={model.rail.sectionPointerDrag}
        reorderRailSection={model.rail.reorderSection}
        projectPointerDrag={model.rail.projectPointerDrag}
        reorderProject={(sourceID, targetID, placement) =>
          void model.notices.run(() => model.rail.reorderProject(sourceID, targetID, placement))
        }
        dropRailSection={model.rail.dropSection}
        dropProject={(targetID, placement) =>
          void model.notices.run(() => model.rail.dropProject(targetID, placement))
        }
        dropView={(targetID, placement) => void model.notices.run(() => model.rail.dropView(targetID, placement))}
        moveRailSection={model.rail.moveSection}
        moveProject={(projectID, offset) => void model.notices.run(() => model.rail.moveProject(projectID, offset))}
        moveView={(viewID, offset) => void model.notices.run(() => model.rail.moveView(viewID, offset))}
      />
      <main class="stage" data-layout={model.navigation.layoutMode()}>
        <Show
          when={
            model.authoritative.state()?.lifecycle.status === "reconnecting" ||
            (model.authoritative.state()?.lifecycle.status === "error" &&
              model.authoritative.state()?.lifecycle.data === "stale")
          }
        >
          <div class="sync-status-banner" role="status" aria-live="polite">
            <span>
              <strong>Connection interrupted.</strong> Showing the last authoritative state while OpencodeX reconnects.
            </span>
            <Button appearance="outline" type="button" onClick={() => void model.notices.run(model.authoritative.retry)}>
              Retry now
            </Button>
          </div>
        </Show>
        <div class={`stage-content ${model.navigation.layoutMode()}`}>
          <Show when={model.authoritative.loading()}>
            <AppLoadingSkeleton />
          </Show>
          <Show when={model.authoritative.error()}>
            <div class="error-card" role="alert">
              <strong>Unable to load authoritative state</strong>
              <span>{model.authoritative.error()}</span>
              <Button appearance="solid" tone="accent" type="button" onClick={() => void model.notices.run(model.authoritative.retry)}>
                Retry now
              </Button>
            </div>
          </Show>
          <Show when={!model.authoritative.loading() && !model.authoritative.error()}>
            <Suspense fallback={<AppLoadingSkeleton />}>
              <AppRoutes model={model} />
            </Suspense>
          </Show>
        </div>
      </main>
      <CommandPaletteModal
        open={model.overlays.commandPaletteOpen()}
        commands={model.commands.commands()}
        close={() => model.overlays.setCommandPaletteOpen(false)}
        run={(command) => {
          model.overlays.setCommandPaletteOpen(false)
          void model.notices.run(async () => command.run())
        }}
      />
      <KeyboardHelpModal
        open={model.overlays.keyboardHelpOpen()}
        commands={model.commands.commands()}
        close={() => model.overlays.setKeyboardHelpOpen(false)}
      />
      <Show when={model.notices.notice()}>
        {(notice) => (
          <div
            class="app-notice"
            classList={{ error: notice().tone === "error" }}
            role={notice().tone === "error" ? "alert" : "status"}
            aria-live={notice().tone === "error" ? "assertive" : "polite"}
          >
            <span>{notice().message}</span>
            <Button appearance="ghost" type="button" aria-label="Dismiss notification" onClick={() => model.notices.clear()}>
              ×
            </Button>
          </div>
        )}
      </Show>
      <DialogModal dialog={model.dialogs.dialog()} close={model.dialogs.close} />
    </div>
  )
}
