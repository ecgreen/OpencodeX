import { lazy } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"

const DiffPage = lazy(() => import("./diff-page").then((module) => ({ default: module.DiffPage })))
const SettingsPage = lazy(() => import("./settings-page").then((module) => ({ default: module.SettingsPage })))
const StatusPage = lazy(() => import("./collection-pages").then((module) => ({ default: module.StatusPage })))

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
  return <SettingsPage controller={props.model.settings} />
}
