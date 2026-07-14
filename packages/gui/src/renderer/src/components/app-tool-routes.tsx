import { lazy } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { LOAD_MORE_MESSAGE_MULTIPLIER, SESSION_MESSAGE_PAGE_LIMIT } from "../controllers/authoritative-state-controller"
import { CollectionPage, StatusPage } from "./collection-pages"

const DiffPage = lazy(() => import("./diff-page").then((module) => ({ default: module.DiffPage })))
const WorkbenchPage = lazy(() => import("./workbench-page").then((module) => ({ default: module.WorkbenchPage })))

export function WorkbenchRoute(props: { model: GuiAppModel }) {
  const model = props.model
  const route = model.navigation.route()
  if (route.name !== "workbench") return
  return (
    <WorkbenchPage
      gui={model.authoritative.client()}
      snapshot={model.authoritative.snapshot()}
      projects={model.authoritative.snapshot()?.projects ?? []}
      projectID={route.projectID}
      recentModels={model.sessionState.recentModels()}
      selectedAgent={model.sessionState.selectedAgent()}
      setSelectedAgent={model.sessionState.setSelectedAgent}
      selectedModel={model.sessionState.selectedModel()}
      setSelectedModel={(value) => {
        model.sessionState.setSelectedModel(value)
        model.sessionState.setSelectedVariant("")
        if (value) model.sessionActions.rememberModel(value)
      }}
      selectedVariant={model.sessionState.selectedVariant()}
      setSelectedVariant={model.sessionState.setSelectedVariant}
      rememberModel={model.sessionActions.rememberModel}
      refresh={model.authoritative.refresh}
      hydrateSession={(sessionID, before) =>
        model.authoritative.loadSession(sessionID, {
          messageLimit: before
            ? SESSION_MESSAGE_PAGE_LIMIT * LOAD_MORE_MESSAGE_MULTIPLIER
            : SESSION_MESSAGE_PAGE_LIMIT,
          messageBefore: before,
        })
      }
      replyPermission={(request, reply) => void model.notices.run(() => model.management.permission(request, reply))}
      replyQuestion={(request, answers) =>
        void model.notices.run(() => model.management.replyToQuestion(request, answers))
      }
      rejectQuestion={(request) => void model.notices.run(() => model.management.rejectQuestionRequest(request))}
      abortSession={(sessionID) => void model.notices.run(() => model.sessionActions.abort(sessionID))}
      renameSession={(session) => void model.notices.run(() => model.sessionActions.rename(session))}
      moveSession={(session) => void model.notices.run(() => model.sessionActions.move(session))}
      deleteSession={(session) => void model.notices.run(() => model.sessionActions.remove(session))}
      slashCommands={(session, data, restorePrompt) => model.sessionSlash.commands(session, { data, restorePrompt })}
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
      sendToComposer={model.sessionComposer.openWorkbenchPrompt}
      openDiff={() =>
        model.navigation.setRoute({
          name: "diff",
          mode: "git",
          sessionID: model.sessionSelection.selectedSession()?.id,
        })
      }
      openExternal={(url) => void globalThis.open(url, "_blank", "noopener")}
      askText={model.dialogs.askText}
      confirm={model.dialogs.confirm}
    />
  )
}

export function DiffRoute(props: { model: GuiAppModel }) {
  const model = props.model
  const route = model.navigation.route()
  const session =
    route.name === "diff"
      ? (model.authoritative.snapshot()?.sessions.find((item) => item.id === route.sessionID) ??
        model.sessionSelection.selectedSession())
      : model.sessionSelection.selectedSession()
  const mode = route.name === "diff" ? (route.mode ?? "git") : "git"
  return (
    <DiffPage
      mode={mode}
      session={session}
      sessions={model.sessionSelection.visibleSessions()}
      sessionUiState={model.authoritative.snapshot()?.sessionUiState ?? {}}
      setMode={(mode) => model.navigation.setRoute({ name: "diff", mode, sessionID: session?.id })}
      selectSession={(sessionID) =>
        model.navigation.setRoute({ name: "diff", mode: sessionID ? "last-turn" : "git", sessionID })
      }
      close={() =>
        model.navigation.setRoute(session ? { name: "session", sessionID: session.id } : { name: "dashboard" })
      }
      loadDiff={model.sessionActions.loadDiff}
      updateReviewedFiles={model.sessionActions.updateReviewedFiles}
    />
  )
}

export function StatusRoute(props: { model: GuiAppModel }) {
  return <StatusPage snapshot={props.model.authoritative.snapshot()} />
}

export function SettingsRoute(props: { model: GuiAppModel }) {
  return (
    <CollectionPage
      title="Settings"
      count={props.model.authoritative.snapshot()?.agents.length ?? 0}
      description="Theme, provider, status, docs, debug, and safe GUI preferences are reserved here while settings parity is built out."
    />
  )
}
