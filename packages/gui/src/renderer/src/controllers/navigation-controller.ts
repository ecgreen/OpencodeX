import { createMemo, createSignal } from "solid-js"
import { routeLayoutMode, type Route } from "../lib/routes"

export const NAV_ITEMS = [
  {
    name: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    shortcut: "Ctrl+D",
    description: "Workspace command center",
  },
  {
    name: "projects",
    label: "Projects",
    icon: "folder",
    shortcut: "Ctrl+1",
    description: "Manage project groups and folders",
  },
  {
    name: "swarms",
    label: "Swarms",
    icon: "swarm",
    shortcut: "Ctrl+2",
    description: "Create, manage, and run agent swarms",
  },
  {
    name: "views",
    label: "Views",
    icon: "views",
    shortcut: "Ctrl+3",
    description: "Create and manage multi-session views",
  },
] as const

export function createNavigationController(initialRoute: Route = { name: "dashboard" }) {
  const history = [initialRoute]
  const [route, setRouteValue] = createSignal(initialRoute)
  const [historyIndex, setHistoryIndex] = createSignal(0)

  function setRoute(next: Route, options?: { replace?: boolean }) {
    if (JSON.stringify(route()) === JSON.stringify(next)) return
    if (options?.replace) {
      history[historyIndex()] = next
      setRouteValue(next)
      return
    }
    history.splice(historyIndex() + 1)
    history.push(next)
    setHistoryIndex(history.length - 1)
    setRouteValue(next)
  }

  function goHistory(offset: -1 | 1) {
    const nextIndex = historyIndex() + offset
    const next = history[nextIndex]
    if (!next) return
    setHistoryIndex(nextIndex)
    setRouteValue(next)
  }

  return {
    route,
    setRoute,
    layoutMode: createMemo(() => routeLayoutMode(route())),
    canGoBack: createMemo(() => historyIndex() > 0),
    canGoForward: createMemo(() => historyIndex() < history.length - 1),
    goBack: () => goHistory(-1),
    goForward: () => goHistory(1),
  }
}
