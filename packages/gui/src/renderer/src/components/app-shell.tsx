import { Button } from "./ui"
import { Show, Suspense, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { terminalSessionRoute } from "../controllers/claude-terminal-controller"
import { NAV_ITEMS } from "../controllers/navigation-controller"
import { guiPluginThemeCss } from "../lib/gui-plugins"
import { projectSessions } from "../lib/app-session-lists"
import { title } from "../lib/format"
import {
  RENDERER_PERFORMANCE_MARKS,
  RENDERER_PERFORMANCE_MEASURES,
  markPerformance,
  measurePerformance,
} from "../lib/performance"
import { shouldShowConnectionWarning } from "../lib/connection-warning"
import { deriveSessionStatus, deriveViewStatus, sessionStatusLabel, sessionStatusTone } from "../lib/session-status"
import { AppLoadingSkeleton } from "./app-loading"
import { AppRoutes } from "./app-routes"
import { Titlebar } from "./chrome"
import type { TitlebarBreadcrumb } from "./titlebar"
import { CommandPaletteModal, type PaletteTarget } from "./command-palette"
import { DialogModal } from "./dialog-modal"
import { KeyboardHelpModal } from "./keyboard-help"
import { RailSidebar } from "./rail-sidebar"
import { SessionSwitcherOverlay } from "./session-switcher-overlay"
import { sessionPaletteTarget, terminalSessionPaletteTarget, titlebarPageLabel } from "./app-shell-palette"

export function AppShell(props: { model: GuiAppModel }) {
  const model = props.model
  let paintFrame: number | undefined
  let authoritativePainted = false
  onMount(() => {
    markPerformance(RENDERER_PERFORMANCE_MARKS.appShellMounted)
    measurePerformance(
      RENDERER_PERFORMANCE_MEASURES.bootstrapToAppShellMounted,
      RENDERER_PERFORMANCE_MARKS.bootstrap,
      RENDERER_PERFORMANCE_MARKS.appShellMounted,
    )
    // Deep components (e.g. the terminal surface) request the guided CLI
    // install without threading dialog access through every layer.
    const installClaude = () => void model.dialogs.askClaudeInstall()
    window.addEventListener("opencodex:claude-install", installClaude)
    onCleanup(() => window.removeEventListener("opencodex:claude-install", installClaude))
  })
  createEffect(() => {
    const ready = !model.authoritative.loading() && !model.authoritative.error()
    if (!ready) {
      if (paintFrame !== undefined) cancelAnimationFrame(paintFrame)
      paintFrame = undefined
      return
    }
    if (authoritativePainted || paintFrame !== undefined) return
    paintFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => {
        paintFrame = undefined
        if (model.authoritative.loading() || model.authoritative.error()) return
        authoritativePainted = true
        markPerformance(RENDERER_PERFORMANCE_MARKS.authoritativePainted)
        measurePerformance(
          RENDERER_PERFORMANCE_MEASURES.bootstrapToAuthoritativePaint,
          RENDERER_PERFORMANCE_MARKS.bootstrap,
          RENDERER_PERFORMANCE_MARKS.authoritativePainted,
        )
      })
    })
  })
  onCleanup(() => {
    if (paintFrame !== undefined) cancelAnimationFrame(paintFrame)
  })
  const paletteTargets = createMemo<PaletteTarget[]>(() => {
    const snapshot = model.authoritative.snapshot()
    if (!snapshot) return []
    return [
      ...model.sessionSelection
        .visibleSessions()
        .map((session) => sessionPaletteTarget(snapshot, session, model.sessionActions.open)),
      ...snapshot.terminalSessions.map((session) => terminalSessionPaletteTarget(
        session,
        model.claudeTerminals.statusLabel(session),
        (terminalSessionID) => model.navigation.setRoute({ name: "terminal-session", terminalSessionID }),
      )),
      ...snapshot.projects.map(
        (project): PaletteTarget => ({
          kind: "project",
          id: project.id,
          title: title(project.name ?? project.project.name),
          subtitle: `${project.sessionIDs.length + project.terminalSessions.length} sessions`,
          run: () => model.navigation.setRoute({ name: "projects", projectID: project.id }),
        }),
      ),
      ...snapshot.views.map(
        (view): PaletteTarget => ({
          kind: "view",
          id: view.id,
          title: title(view.title),
          subtitle: `${view.members.length} panes`,
          run: () => model.navigation.setRoute({ name: "views", viewID: view.id }),
        }),
      ),
    ]
  })
  const paletteRecents = createMemo<PaletteTarget[]>(() => {
    const snapshot = model.authoritative.snapshot()
    if (!snapshot) return []
    return [
      ...model.sessionSwitcher
      .sessions()
      .map((session) => sessionPaletteTarget(snapshot, session, model.sessionActions.open)),
      ...[...snapshot.terminalSessions]
        .sort((a, b) => Number(b.timeOpened ?? b.timeUpdated) - Number(a.timeOpened ?? a.timeUpdated))
        .map((session) => terminalSessionPaletteTarget(
          session,
          model.claudeTerminals.statusLabel(session),
          (terminalSessionID) => model.navigation.setRoute({ name: "terminal-session", terminalSessionID }),
        )),
    ]
  })
  const navBadges = createMemo((): Record<string, number> => {
    const snapshot = model.authoritative.snapshot()
    if (!snapshot) return {}
    const needsInput = new Set([
      ...snapshot.permissions.map((request) => request.sessionID),
      ...snapshot.questions.map((request) => request.sessionID),
    ])
    return {
      dashboard: needsInput.size,
      views: snapshot.views.filter((view) => view.sessionIDs.some((sessionID) => needsInput.has(sessionID))).length,
    }
  })
  const breadcrumb = createMemo((): TitlebarBreadcrumb => {
    const route = model.navigation.route()
    const snapshot = model.authoritative.snapshot()
    if (route.name === "session" || route.name === "new-session") {
      const session = model.sessionSelection.selectedSession()
      const project = model.sessionSelection.activeSessionProjectName()
      const status = session ? deriveSessionStatus(snapshot, session) : undefined
      return {
        context: project ? title(project) : undefined,
        openContext: project ? () => model.navigation.setRoute({ name: "projects" }) : undefined,
        current: session ? title(session.title) : "New session",
        status: status && status !== "dormant" ? sessionStatusLabel(status) : undefined,
        statusTone: status ? sessionStatusTone(status) : undefined,
      }
    }
    if (route.name === "terminal-session") {
      const terminalSession = snapshot?.terminalSessions.find((item) => item.id === route.terminalSessionID)
      if (terminalSession)
        return {
          context: "Sessions",
          openContext: () => model.navigation.setRoute({ name: "sessions" }),
          current: title(terminalSession.title),
          status: "Claude Code",
          statusTone: "info",
        }
    }
    if (route.name === "projects" && route.projectID) {
      const project = snapshot?.projects.find((item) => item.id === route.projectID)
      if (project)
        return {
          context: "Projects",
          openContext: () => model.navigation.setRoute({ name: "projects" }),
          current: title(project.name ?? project.project.name),
        }
    }
    if (route.name === "views") {
      const view = model.view.activeView()
      if (view) {
        const status = deriveViewStatus(view, snapshot)
        return {
          context: "Views",
          openContext: () => model.navigation.setRoute({ name: "views" }),
          current: title(view.title),
          status: status !== "dormant" ? sessionStatusLabel(status) : undefined,
          statusTone: sessionStatusTone(status),
        }
      }
    }
    return { current: titlebarPageLabel(route.name) }
  })
  return (
    <div
      class="app-shell"
      classList={{ "rail-collapsed": model.rail.collapsed(), "rail-resizing": model.rail.resizing() }}
      style={{ "--rail-width": `${model.rail.width()}px` }}
    >
      <style>{guiPluginThemeCss(model.plugins.plugins())}</style>
      <Titlebar
        canGoBack={model.navigation.canGoBack()}
        canGoForward={model.navigation.canGoForward()}
        goBack={model.navigation.goBack}
        goForward={model.navigation.goForward}
        breadcrumb={breadcrumb()}
        newSession={() => void model.notices.run(() => model.management.createSession())}
        newClaudeSession={() =>
          void model.notices.run(async () => {
            await model.management.createClaudeSession()
          })
        }
        newProject={() => void model.notices.run(model.management.createProject)}
        newView={() => void model.notices.run(model.management.createView)}
        newSwarm={() => void model.notices.run(() => model.management.createSwarm())}
        openDashboard={() => model.navigation.setRoute({ name: "dashboard" })}
        openProjects={() => model.navigation.setRoute({ name: "projects" })}
        openSessions={() => model.navigation.setRoute({ name: "sessions" })}
        openSwarms={() => model.navigation.setRoute({ name: "swarms" })}
        openViews={() => model.navigation.setRoute({ name: "views" })}
        toggleLeftSidebar={() => model.rail.setCollapsed((collapsed) => !collapsed)}
        toggleViewSidePanel={model.view.items().length > 0 ? model.view.toggleSidePanel : undefined}
        openCommandPalette={() => model.overlays.setCommandPaletteOpen(true)}
        openKeyboardHelp={() => model.overlays.setKeyboardHelpOpen(true)}
      />
      <RailSidebar
        snapshot={model.authoritative.snapshot()}
        sessions={model.sessionSelection.visibleSessions()}
        terminalSessions={model.authoritative.snapshot()?.terminalSessions ?? []}
        hasMoreSessions={model.authoritative.state()?.sessionCards.hasMore ?? false}
        loadingMoreSessions={model.authoritative.state()?.sessionCards.loading ?? false}
        loadMoreSessions={() => void model.notices.run(() => model.authoritative.loadMoreSessionCards().then(() => undefined))}
        pinnedSessions={model.rail.pinnedSessions()}
        pinnedTerminalSessions={model.rail.pinnedTerminalSessions()}
        pinnedViews={model.rail.pinnedViews()}
        navItems={NAV_ITEMS}
        navBadges={navBadges()}
        activeRouteName={model.navigation.route().name}
        activeSessionID={model.sessionSelection.activeSessionID()}
        activeTerminalSessionID={(() => {
          const route = model.navigation.route()
          return route.name === "terminal-session" ? route.terminalSessionID : ""
        })()}
        activeViewID={model.view.activeView()?.id}
        railCollapsed={model.rail.collapsed()}
        railWidth={model.rail.width()}
        resizeRail={model.rail.setWidth}
        setRailResizing={model.rail.setResizing}
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
        openSettings={() => model.navigation.setRoute({ name: "settings" })}
        openRoute={(name) => model.navigation.setRoute({ name })}
        openSession={model.sessionActions.open}
        openTerminalSession={(terminalSessionID) => model.navigation.setRoute(terminalSessionRoute(model.authoritative.snapshot()?.terminalSessions.find((record) => record.id === terminalSessionID), terminalSessionID))}
        openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
        openAllViews={() => model.navigation.setRoute({ name: "views" })}
        createProject={() => void model.notices.run(model.management.createProject)}
        createSession={(projectID, directory) =>
          void model.notices.run(() => model.management.createSession(projectID, directory))
        }
        createTerminalSession={(projectID, directory) =>
          void model.notices.run(async () => { await model.management.createClaudeSession(projectID, directory) })
        }
        createPinnedSession={() => void model.notices.run(model.management.createPinnedSession)}
        createView={() => void model.notices.run(model.management.createView)}
        toggleSessionPinned={model.rail.toggleSessionPinned}
        toggleViewPinned={model.rail.toggleViewPinned}
        renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
        deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
        renameTerminalSession={(session) => void model.notices.run(() => model.management.renameClaudeSession(session))}
        removeTerminalSession={(session) => void model.notices.run(() => model.management.removeClaudeSession(session))}
        terminalStatus={model.claudeTerminals.statusLabel}
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
        dropProject={(targetID, placement) => void model.notices.run(() => model.rail.dropProject(targetID, placement))}
        dropView={(targetID, placement) => void model.notices.run(() => model.rail.dropView(targetID, placement))}
        moveRailSection={model.rail.moveSection}
        moveProject={(projectID, offset) => void model.notices.run(() => model.rail.moveProject(projectID, offset))}
        moveView={(viewID, offset) => void model.notices.run(() => model.rail.moveView(viewID, offset))}
      />
      <main class="stage" data-layout={model.navigation.layoutMode()}>
        <Show
          when={shouldShowConnectionWarning(model.authoritative.state()?.lifecycle)}
        >
          <div class="sync-status-banner" role="status" aria-live="polite">
            <span>
              <strong>Connection interrupted.</strong> Showing the last authoritative state while OpencodeX reconnects.
            </span>
            <Button
              appearance="outline"
              type="button"
              onClick={() => void model.notices.run(model.authoritative.retry)}
            >
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
              <Button
                appearance="solid"
                tone="accent"
                type="button"
                onClick={() => void model.notices.run(model.authoritative.retry)}
              >
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
        targets={paletteTargets()}
        recents={paletteRecents()}
        close={() => model.overlays.setCommandPaletteOpen(false)}
        run={(selection) => {
          model.overlays.setCommandPaletteOpen(false)
          if (selection.kind === "target") {
            selection.target.run()
            return
          }
          void model.notices.run(async () => selection.command.run())
        }}
      />
      <KeyboardHelpModal
        open={model.overlays.keyboardHelpOpen()}
        commands={model.commands.commands()}
        close={() => model.overlays.setKeyboardHelpOpen(false)}
      />
      <SessionSwitcherOverlay
        open={model.sessionSwitcher.open()}
        cursor={model.sessionSwitcher.cursor()}
        query={model.sessionSwitcher.query()}
        sticky={model.sessionSwitcher.sticky()}
        rows={model.sessionSwitcher.rows()}
        snapshot={model.authoritative.snapshot()}
        terminalStatus={(item) => model.claudeTerminals.statusLabel(item.terminalSession)}
        preview={model.sessionSwitcher.preview}
        filter={model.sessionSwitcher.filter}
        move={model.sessionSwitcher.move}
        select={model.sessionSwitcher.setCursor}
        commit={model.sessionSwitcher.commit}
        cancel={model.sessionSwitcher.cancel}
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
            <Button
              appearance="ghost"
              type="button"
              aria-label="Dismiss notification"
              onClick={() => model.notices.clear()}
            >
              ×
            </Button>
          </div>
        )}
      </Show>
      <DialogModal dialog={model.dialogs.dialog()} close={model.dialogs.close} />
    </div>
  )
}
