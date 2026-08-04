import { Show, lazy } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { terminalSessionRoute } from "../controllers/claude-terminal-controller"
import { OpencodeXLogo } from "./chrome"
import { Dashboard } from "./dashboard"
import { findFiles } from "../lib/session-api"
import { openSessionWorkspace } from "../lib/session-workspace-bridge"
import { ClaudeTerminalPage } from "./claude-terminal-surface"
import { Button, ErrorState, LoadingState } from "./ui"

const ProjectCollectionPage = lazy(() =>
  import("./collection-pages").then((module) => ({ default: module.ProjectCollectionPage })),
)
const SessionCollectionPage = lazy(() =>
  import("./collection-pages").then((module) => ({ default: module.SessionCollectionPage })),
)
const SessionPage = lazy(() => import("./session-page-entry").then((module) => ({ default: module.SessionPageEntry })))

export function DashboardRoute(props: { model: GuiAppModel }) {
  const model = props.model
  return (
      <Dashboard
        snapshot={model.authoritative.snapshot()}
        sessionOrderState={model.sessionSelection.orderState()}
      logo={<OpencodeXLogo active={false} />}
      openProject={(projectID) => model.navigation.setRoute({ name: "projects", projectID })}
      openSession={model.sessionActions.open}
      openSwarm={(swarmID) => model.navigation.setRoute({ name: "swarm-create", swarmID })}
      openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
      viewPinned={(viewID) => model.rail.pinnedViewIDSet().has(viewID)}
      createProject={() => void model.notices.run(model.management.createProject)}
      createSession={(projectID, directory) =>
        void model.notices.run(() => model.management.createSession(projectID, directory))
      }
      createSwarm={() => void model.notices.run(() => model.management.createSwarm())}
      createView={() => void model.notices.run(model.management.createView)}
      toggleViewPinned={model.rail.toggleViewPinned}
      renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
      deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
      editView={(viewID) => model.navigation.setRoute({ name: "view-edit", viewID })}
      deleteView={(viewID, name) => void model.notices.run(() => model.capabilities.deleteViewByID(viewID, name))}
      editProject={(projectID, current, folders) =>
        void model.notices.run(() => model.management.editProject(projectID, current, folders))
      }
      deleteProject={(projectID, name) =>
        void model.notices.run(() => model.management.deleteProject(projectID, name))
      }
    />
  )
}

export function SessionRoute(props: { model: GuiAppModel }) {
  const model = props.model
  const session = () => model.sessionSelection.selectedSession()
  return (
    <SessionPage
      session={session()}
      projectName={model.sessionSelection.activeSessionProjectName()}
      data={model.sessionSelection.activeSessionData()}
      loading={model.sessionSelection.activeSessionLoading()}
      prompt={model.sessionState.prompt()}
      setPrompt={model.sessionState.setPrompt}
      composerFocusToken={model.sessionState.composerFocusToken}
      providers={model.authoritative.snapshot()?.providers ?? []}
      connectedProviderIDs={model.authoritative.snapshot()?.connectedProviderIDs ?? []}
      swarms={model.authoritative.snapshot()?.swarms ?? []}
      team={model.swarmTeam.team()}
      goal={model.swarmTeam.goal()}
      approveGoalNode={(goalID, nodeID, approved) =>
        void model.notices.run(() => model.management.approveGoalNode(goalID, nodeID, approved))
      }
      cancelGoal={(goalID) => void model.notices.run(() => model.management.cancelGoal(goalID))}
      teamMemberSessionID={model.swarmTeam.memberSessionID()}
      // The team pane and the graph pane both own the session's main area, so
      // opening either one closes the other.
      selectTeamMember={(sessionID) => {
        model.sessionGraph.back()
        model.swarmTeam.setMemberSessionID(sessionID)
      }}
      teamMemberData={model.authoritative.viewSessionData()[model.swarmTeam.memberSessionID()]}
      teamMemberLoading={model.authoritative.viewPaneState(model.swarmTeam.memberSessionID()).loading}
      loadOlderEmbeddedMessages={(sessionID, cursor) =>
        model.notices.run(() => model.authoritative.loadOlderViewSessionMessages(sessionID, cursor))
      }
      graph={model.sessionGraph.graph()}
      graphTopology={model.sessionGraph.topology()}
      retryGraphTopology={model.sessionGraph.retryTopology}
      graphSelectedNodeID={model.sessionGraph.selectedNodeID()}
      graphNodeSessionID={model.sessionGraph.nodeSessionID()}
      graphNodeData={model.authoritative.viewSessionData()[model.sessionGraph.nodeSessionID()]}
      graphNodeLoading={model.authoritative.viewPaneState(model.sessionGraph.nodeSessionID()).loading}
      graphNodeWorkItem={model.authoritative
        .workItems()
        .find((item) => item.id === `session:${model.sessionGraph.nodeSessionID()}`)}
      graphNodeSession={model.sessionGraph.nodeSession()}
      graphNodeJobs={(model.authoritative.snapshot()?.jobs ?? []).filter(
        (job) => job.sessionID === model.sessionGraph.nodeSessionID(),
      )}
      openGraphNode={(node) => {
        model.swarmTeam.setMemberSessionID("")
        model.sessionGraph.openNode(node)
      }}
      // Swarm-delegated children are not in the catalog, so the full session
      // route cannot resolve them - the embedded pane is the only place they
      // can be read. This one check guards every full-page entry point: the
      // embedded header's button and the canvas's Ctrl/Cmd-click.
      canOpenGraphNodeFullPage={(sessionID) =>
        (model.authoritative.snapshot()?.sessions ?? []).some((session) => session.id === sessionID)
      }
      openGraphNodeFullPage={(node) => {
        if (!node.sessionID) return
        // The same capability check as the buttons that lead here: a route
        // that cannot resolve must not be navigated to, whatever called this.
        if (!(model.authoritative.snapshot()?.sessions ?? []).some((session) => session.id === node.sessionID)) {
          model.swarmTeam.setMemberSessionID("")
          model.sessionGraph.openNode(node)
          return
        }
        // Closing the embedded pane first is the whole job: the route changes
        // underneath it, but an opened node survives the change (it is still in
        // the new session's own graph), so the pane stays mounted over the page
        // that was just navigated to and the button reads as doing nothing.
        model.sessionGraph.back()
        model.swarmTeam.setMemberSessionID("")
        model.sessionActions.open(node.sessionID)
      }}
      retryEmbeddedSession={(sessionID) => {
        const session = model.sessionGraph.mergedSessions().find((item) => item.id === sessionID)
        if (session) void model.authoritative.syncViewSession(session, { force: true })
      }}
      embeddedSessionError={(sessionID) => model.authoritative.viewPaneState(sessionID).error}
      closeGraphNode={model.sessionGraph.back}
      connectProvider={(providerID) => void model.notices.run(() => model.capabilities.connectProvider(providerID))}
      mcp={model.authoritative.snapshot()?.mcp ?? {}}
      mcpResources={model.authoritative.snapshot()?.mcpResources ?? {}}
      lsp={model.authoritative.snapshot()?.lsp ?? []}
      config={model.authoritative.snapshot()?.config}
      agents={model.authoritative.snapshot()?.agents ?? []}
      findFiles={(input) =>
        model.authoritative.client() ? findFiles(model.authoritative.client()!, input) : Promise.resolve([])
      }
      selectedAgent={model.sessionState.selectedAgent()}
      setSelectedAgent={model.sessionState.setSelectedAgent}
      selectedModel={model.sessionState.selectedModel()}
      recentModels={model.sessionState.recentModels()}
      setSelectedModel={(value) => {
        model.sessionState.setSelectedModel(value)
        model.sessionState.setSelectedVariant("")
        if (value) model.sessionActions.rememberModel(value)
      }}
      selectedVariant={model.sessionState.selectedVariant()}
      setSelectedVariant={model.sessionState.setSelectedVariant}
      submit={(event, prompt) => model.notices.attempt(() => model.sessionComposer.submit(event, prompt))}
      permissions={model.sessionSelection.selectedPermissions()}
      questions={model.sessionSelection.selectedQuestions()}
      replyPermission={(request, reply) => void model.notices.run(() => model.management.permission(request, reply))}
      replyQuestion={(request, answers) =>
        void model.notices.run(() => model.management.replyToQuestion(request, answers))
      }
      rejectQuestion={(request) => void model.notices.run(() => model.management.rejectQuestionRequest(request))}
      renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
      moveSession={(session) => void model.notices.run(() => model.sessionActions.move(session))}
      deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
      openTerminalSession={(terminalSessionID) => model.navigation.setRoute({ name: "terminal-session", terminalSessionID })}
      slashCommands={model.sessionSlash.commands(session(), {
        data: model.sessionSelection.activeSessionData(),
        restorePrompt: model.sessionState.setPrompt,
      })}
      concealCodeBlocks={model.transcriptPreferences.concealTranscriptCodeBlocks()}
      showTimestamps={model.transcriptPreferences.showTranscriptTimestamps()}
      showThinking={model.transcriptPreferences.showTranscriptThinking()}
      showToolDetails={model.transcriptPreferences.showTranscriptToolDetails()}
      showScrollbar={model.transcriptPreferences.showTranscriptScrollbar()}
      showGenericToolOutput={model.transcriptPreferences.showTranscriptGenericToolOutput()}
      toggleCodeConceal={model.transcriptPreferences.handleToggleCodeConcealSlash}
      toggleTimestamps={model.transcriptPreferences.handleToggleTimestampsSlash}
      toggleThinking={model.transcriptPreferences.handleToggleThinkingSlash}
      toggleToolDetails={model.transcriptPreferences.handleToggleToolDetailsSlash}
      toggleScrollbar={model.transcriptPreferences.handleToggleScrollbarSlash}
      toggleGenericToolOutput={model.transcriptPreferences.handleToggleGenericToolOutputSlash}
      status={session() ? model.authoritative.snapshot()?.sessionStatus[session()!.id]?.type : undefined}
      abortConfirmArmed={model.commands.abortConfirmSessionID() === session()?.id}
      readyForReview={
        session() ? model.authoritative.snapshot()?.sessionUiState[session()!.id]?.displayStatus === "needs_review" : false
      }
      markSessionReviewed={model.sessionActions.markReviewed}
      pending={model.navigation.route().name === "new-session"}
      loadOlderMessages={(cursor) =>
        session()
          ? model.notices.run(() => model.authoritative.loadOlderSessionMessages(session()!.id, cursor))
          : Promise.resolve()
      }
      collapseMessageWindow={() => {
        const current = session()
        if (current) model.authoritative.collapseSessionMessageWindow(current.id)
      }}
      onMessageAction={(action, context) => model.notices.run(() => model.sessionSlash.messageAction(action, context))}
      gui={model.authoritative.client()}
      subscribeGlobalEvents={model.authoritative.subscribeGlobalEvents}
      sidePanelDirectory={model.sessionActions.sidePanelDirectory(session())}
    />
  )
}

export function SessionsRoute(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <SessionCollectionPage
      sessions={model.sessionSelection.visibleSessions()}
      terminalSessions={model.authoritative.snapshot()?.terminalSessions ?? []}
      projects={model.authoritative.snapshot()?.projects ?? []}
      sessionStatus={model.authoritative.snapshot()?.sessionStatus ?? {}}
      openSession={model.sessionActions.open}
      openTerminalSession={(terminalSessionID) => model.navigation.setRoute(terminalSessionRoute(model.authoritative.snapshot()?.terminalSessions.find((record) => record.id === terminalSessionID), terminalSessionID))}
      renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
      moveSession={(session) => void model.notices.run(() => model.sessionActions.move(session))}
      deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
      renameTerminalSession={(session) => void model.notices.run(() => model.management.renameClaudeSession(session))}
      moveTerminalSession={(session) => void model.notices.run(() => model.management.moveClaudeSession(session))}
      removeTerminalSession={(session) => void model.notices.run(() => model.management.removeClaudeSession(session))}
      terminalStatus={model.claudeTerminals.statusLabel}
      sessionPinned={(sessionID) => model.rail.pinnedSessionIDSet().has(sessionID)}
      toggleSessionPinned={model.rail.toggleSessionPinned}
      createSession={() => void model.notices.run(() => model.management.createSession())}
    />
  )
}

export function TerminalSessionRoute(props: { model: GuiAppModel }) {
  const route = () => props.model.navigation.route()
  const terminalSession = () => {
    const current = route()
    if (current.name !== "terminal-session") return undefined
    return props.model.authoritative.snapshot()?.terminalSessions.find((item) => item.id === current.terminalSessionID)
  }
  return (
    <Show
      when={terminalSession()}
      fallback={
        props.model.authoritative.snapshot() ? (
          <ErrorState
            title="Claude Code session not found"
            description="The catalog record may have been removed."
            action={
              <Button appearance="solid" tone="accent" onClick={() => props.model.navigation.setRoute({ name: "sessions" })}>
                Back to Sessions
              </Button>
            }
          />
        ) : (
          <LoadingState title="Loading Claude Code session" />
        )
      }
    >
      {(record) => (
        <ClaudeTerminalPage
          terminalSession={record()}
          controller={props.model.claudeTerminals}
          gui={props.model.authoritative.client()}
          subscribeGlobalEvents={props.model.authoritative.subscribeGlobalEvents}
          snapshot={props.model.authoritative.snapshot()}
          rename={() => void props.model.notices.run(() => props.model.management.renameClaudeSession(record()))}
          move={() => void props.model.notices.run(() => props.model.management.moveClaudeSession(record()))}
          remove={() => void props.model.notices.run(() => props.model.management.removeClaudeSession(record()))}
        />
      )}
    </Show>
  )
}

export function ProjectsRoute(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <ProjectCollectionPage
      snapshot={model.authoritative.snapshot()}
      workItems={model.authoritative.workItems()}
      attentionItems={model.authoritative.attentionItems()}
      sessionOrderState={model.sessionSelection.orderState()}
      projectID={model.sessionSelection.activeProject()?.id}
      openProject={(projectID) =>
        model.navigation.setRoute(projectID ? { name: "projects", projectID } : { name: "projects" })
      }
      openSession={model.sessionActions.open}
      openTerminalSession={(terminalSessionID) => model.navigation.setRoute(terminalSessionRoute(model.authoritative.snapshot()?.terminalSessions.find((record) => record.id === terminalSessionID), terminalSessionID))}
      openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
      openSwarm={(swarmID) => model.navigation.setRoute({ name: "swarm-create", swarmID })}
      createSession={(projectID, directory) =>
        void model.notices.run(() => model.management.createSession(projectID, directory))
      }
      launchClaudeSession={(projectID, directory) =>
        void model.notices.run(() => model.management.launchClaudeSession(projectID, directory))
      }
      createProjectView={(projectID, sessionIDs) =>
        void model.notices.run(() => model.management.createProjectView(projectID, sessionIDs))
      }
      createProject={() => void model.notices.run(model.management.createProject)}
      editProject={(projectID, currentName, folders) =>
        void model.notices.run(() => model.management.editProject(projectID, currentName, folders))
      }
      deleteProject={(projectID, name) =>
        void model.notices.run(() => model.management.deleteProject(projectID, name))
      }
      renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
      deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
      renameTerminalSession={(session) => void model.notices.run(() => model.management.renameClaudeSession(session))}
      removeTerminalSession={(session) => void model.notices.run(() => model.management.removeClaudeSession(session))}
      moveProject={(projectID, offset) => void model.notices.run(() => model.rail.moveProject(projectID, offset))}
      reorderProject={(sourceID, targetID, placement) =>
        void model.notices.run(() => model.rail.reorderProject(sourceID, targetID, placement))
      }
      sessionPinned={(sessionID) => model.rail.pinnedSessionIDSet().has(sessionID)}
      toggleSessionPinned={model.rail.toggleSessionPinned}
      terminalStatus={(terminalSessionID) => {
        const session = model.authoritative.snapshot()?.terminalSessions.find((item) => item.id === terminalSessionID)
        return session ? model.claudeTerminals.statusLabel(session) : "idle"
      }}
    />
  )
}
