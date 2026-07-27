import { Flag } from "@opencode-ai/core/flag/flag"
import { MouseButton } from "@opentui/core"
import { TimeToFirstDraw } from "@opentui/solid"
import { Match, Show, Switch } from "solid-js"
import type { createTuiAppController } from "./app-controller"
import { OpencodeXDashboard, OpencodeXSwarms } from "./component/opencodex-operations"
import { OpencodeXSidebar } from "./component/opencodex-sidebar"
import { OpencodeXViewRoute } from "./component/opencodex-views"
import { StartupLoading } from "./component/startup-loading"
import { TuiPluginRuntime } from "./plugin/runtime"
import { Home } from "./routes/home"
import { Session } from "./routes/session"
import { Selection } from "./util/selection"

export function TuiAppShell(props: { controller: ReturnType<typeof createTuiAppController> }) {
  return (
    <box
      width={props.controller.dimensions().width}
      height={props.controller.dimensions().height}
      flexDirection="column"
      backgroundColor={props.controller.themeState.theme.background}
      onMouseDown={(event) => {
        if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT || event.button !== MouseButton.RIGHT) return
        if (!Selection.copy(props.controller.renderer, props.controller.toast)) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onMouseUp={Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
        ? undefined
        : () => Selection.copy(props.controller.renderer, props.controller.toast)}
    >
      <Show when={Flag.OPENCODE_SHOW_TTFD}><TimeToFirstDraw /></Show>
      <Show when={props.controller.ready()}>
        <box flexGrow={1} minHeight={0} flexDirection="row">
          <OpencodeXSidebar />
          <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="column">
            <Switch>
              <Match when={props.controller.route.data.type === "home"}><Home /></Match>
              <Match when={props.controller.route.data.type === "session"}>
                <Show when={props.controller.route.data.type === "session" ? props.controller.route.data.sessionID : undefined} keyed>
                  {(_sessionID) => <Session />}
                </Show>
              </Match>
              <Match when={props.controller.route.data.type === "opencodex-dashboard"}><OpencodeXDashboard /></Match>
              <Match when={props.controller.route.data.type === "opencodex-swarms"}><OpencodeXSwarms /></Match>
              <Match when={props.controller.route.data.type === "opencodex-swarm-create"}><OpencodeXSwarms /></Match>
              <Match when={props.controller.route.data.type === "opencodex-view"}><OpencodeXViewRoute /></Match>
            </Switch>
            {props.controller.plugin()}
          </box>
        </box>
        <box flexShrink={0}><TuiPluginRuntime.Slot name="app_bottom" /></box>
        <TuiPluginRuntime.Slot name="app" />
      </Show>
      <StartupLoading ready={props.controller.ready} />
    </box>
  )
}
