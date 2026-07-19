import { lazy } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { OpencodeXLogo } from "./chrome"
import { Dashboard } from "./dashboard"
import { findFiles } from "../lib/store"

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
      workItems={model.authoritative.workItems()}
      sessionOrderState={model.sessionSelection.orderState()}
      logo={<OpencodeXLogo active={false} />}
      openProject={(projectID) => model.navigation.setRoute({ name: "projects", projectID })}
      openSession={(sessionID) => model.navigation.setRoute({ name: "session", sessionID })}
      openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
      sessionPinned={(sessionID) => model.rail.pinnedSessionIDSet().has(sessionID)}
      viewPinned={(viewID) => model.rail.pinnedViewIDSet().has(viewID)}
      createProject={() => void model.notices.run(model.management.createProject)}
      createSession={(projectID, directory) =>
        void model.notices.run(() => model.management.createSession(projectID, directory))
      }
      createSwarm={() => void model.notices.run(() => model.management.createSwarm())}
      createView={() => void model.notices.run(model.management.createView)}
      toggleSessionPinned={model.rail.toggleSessionPinned}
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
      submit={model.sessionComposer.submit}
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
      onMessageAction={(action, context) => model.notices.run(() => model.sessionSlash.messageAction(action, context))}
      gui={model.authoritative.client()}
      sidePanelDirectory={model.sessionActions.sidePanelDirectory(session())}
    />
  )
}

export function SessionsRoute(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <SessionCollectionPage
      sessions={model.sessionSelection.visibleSessions()}
      projects={model.authoritative.snapshot()?.projects ?? []}
      sessionStatus={model.authoritative.snapshot()?.sessionStatus ?? {}}
      openSession={model.sessionActions.open}
      renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
      moveSession={(session) => void model.notices.run(() => model.sessionActions.move(session))}
      deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
      sessionPinned={(sessionID) => model.rail.pinnedSessionIDSet().has(sessionID)}
      toggleSessionPinned={model.rail.toggleSessionPinned}
    />
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
      openView={(viewID) => model.navigation.setRoute({ name: "views", viewID })}
      openSwarm={(swarmID) => model.navigation.setRoute({ name: "swarms", swarmID })}
      openWorkbenchProject={(projectID) => model.navigation.setRoute({ name: "workbench", projectID })}
      createSession={(projectID, directory) =>
        void model.notices.run(() => model.management.createSession(projectID, directory))
      }
      createSwarm={(projectID) => void model.notices.run(() => model.management.createSwarm(projectID))}
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
      moveProject={(projectID, offset) => void model.notices.run(() => model.rail.moveProject(projectID, offset))}
      reorderProject={(sourceID, targetID, placement) =>
        void model.notices.run(() => model.rail.reorderProject(sourceID, targetID, placement))
      }
      sessionPinned={(sessionID) => model.rail.pinnedSessionIDSet().has(sessionID)}
      toggleSessionPinned={model.rail.toggleSessionPinned}
    />
  )
}
