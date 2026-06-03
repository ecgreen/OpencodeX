import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  prompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  prompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
}

export type OpencodeXDashboardRoute = {
  type: "opencodex-dashboard"
}

export type OpencodeXSwarmsRoute = {
  type: "opencodex-swarms"
  swarmID?: string
}

export type OpencodeXSwarmCreateRoute = {
  type: "opencodex-swarm-create"
  swarmID?: string
}

export type OpencodeXViewRoute = {
  type: "opencodex-view"
  viewID: string
}

export type Route =
  | HomeRoute
  | SessionRoute
  | PluginRoute
  | OpencodeXDashboardRoute
  | OpencodeXSwarmsRoute
  | OpencodeXSwarmCreateRoute
  | OpencodeXViewRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: (props: { initialRoute?: Route }) => {
    const [store, setStore] = createStore<Route>(
      props.initialRoute ??
        (process.env["OPENCODE_ROUTE"]
          ? JSON.parse(process.env["OPENCODE_ROUTE"])
          : {
              type: "home",
            }),
    )
    const history: Route[] = []

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        history.push({ ...store } as Route)
        setStore(reconcile(route))
      },
      back(fallback: Route) {
        setStore(reconcile(history.pop() ?? fallback))
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
