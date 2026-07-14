import { Match, Switch } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import {
  DashboardRoute,
  ProjectsRoute,
  SessionRoute,
  SessionsRoute,
} from "./app-session-routes"
import {
  PluginsRoute,
  SwarmEditorRoute,
  SwarmsRoute,
  ViewEditorRoute,
  ViewsRoute,
} from "./app-operations-routes"
import { DiffRoute, SettingsRoute, StatusRoute, WorkbenchRoute } from "./app-tool-routes"

export function AppRoutes(props: { model: GuiAppModel }) {
  return (
    <Switch>
      <Match when={props.model.navigation.route().name === "dashboard"}>
        <DashboardRoute model={props.model} />
      </Match>
      <Match when={["session", "new-session"].includes(props.model.navigation.route().name)}>
        <SessionRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "sessions"}>
        <SessionsRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "projects"}>
        <ProjectsRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "swarms"}>
        <SwarmsRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "swarm-create"}>
        <SwarmEditorRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "views"}>
        <ViewsRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "view-edit"}>
        <ViewEditorRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "plugins"}>
        <PluginsRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "workbench"}>
        <WorkbenchRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "diff"}>
        <DiffRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "status"}>
        <StatusRoute model={props.model} />
      </Match>
      <Match when={props.model.navigation.route().name === "settings"}>
        <SettingsRoute model={props.model} />
      </Match>
    </Switch>
  )
}
