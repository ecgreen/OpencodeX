export type DiffMode = "git" | "last-turn"

export type Route =
  | { name: "dashboard" }
  | { name: "sessions" }
  | { name: "new-session"; projectID?: string; directory?: string }
  | { name: "projects"; projectID?: string }
  | { name: "session"; sessionID: string }
  | { name: "terminal-session"; terminalSessionID: string }
  | { name: "swarms" }
  | { name: "swarm-create"; swarmID?: string; projectID?: string }
  | { name: "views"; viewID?: string }
  | { name: "view-edit"; viewID?: string }
  | { name: "plugins" }
  | { name: "diff"; mode?: DiffMode; sessionID?: string }
  | { name: "settings" }
  | { name: "status" }

export type RouteLayoutMode = "scroll-page" | "full-bleed"

const fullBleedRoutes = new Set<Route["name"]>(["new-session", "session", "terminal-session", "views", "diff"])

export function routeLayoutMode(route: Route): RouteLayoutMode {
  return fullBleedRoutes.has(route.name) ? "full-bleed" : "scroll-page"
}
