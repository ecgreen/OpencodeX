import { Match, Switch, onCleanup, onMount } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import {
  DashboardRoute,
  ProjectsRoute,
  SessionRoute,
  SessionsRoute,
  TerminalSessionRoute,
} from "./app-session-routes"
import {
  PluginsRoute,
  SwarmEditorRoute,
  SwarmsRoute,
  ViewEditorRoute,
  ViewsRoute,
} from "./app-operations-routes"
import { DiffRoute, SettingsRoute, StatusRoute } from "./app-tool-routes"

export function AppRoutes(props: { model: GuiAppModel }) {
  onMount(() => {
    const prefetch = () => {
      void Promise.allSettled([
        import("./session-page-entry"),
        import("./views-manager-page-entry"),
      ])
    }
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(prefetch, { timeout: 1_200 })
      onCleanup(() => window.cancelIdleCallback(idle))
      return
    }
    const timer = window.setTimeout(prefetch, 400)
    onCleanup(() => window.clearTimeout(timer))
  })
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
      <Match when={props.model.navigation.route().name === "terminal-session"}>
        <TerminalSessionRoute model={props.model} />
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
