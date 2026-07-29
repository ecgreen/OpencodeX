import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiSnapshot } from "./session-api"
import { pendingSession, viewItemID, type ViewItem } from "./view-items"

type RouteLike = {
  name: string
  sessionID?: string
  projectID?: string
  directory?: string
  viewID?: string
}

export function selectedSessionForRoute(route: RouteLike, snapshot: GuiSnapshot | undefined, defaultDirectory?: string): Session | undefined {
  if (route.name === "new-session") {
    return pendingSession(route.directory ?? snapshot?.projects[0]?.folders[0]?.path ?? defaultDirectory ?? "")
  }
  if (route.name !== "session") return
  return snapshot?.sessions.find((session) => session.id === route.sessionID)
}

export function activeSessionIDForRoute(route: RouteLike) {
  return route.name === "session" ? route.sessionID ?? "" : ""
}

export function activeSessionRouteKey(route: RouteLike) {
  if (route.name === "session") return route.sessionID ?? ""
  if (route.name === "new-session") return `new:${route.projectID ?? ""}:${route.directory ?? ""}`
  return ""
}

export function abortSessionIDForRoute(input: {
  route: RouteLike
  selectedSessionID?: string
  focusedViewSessionID?: string
  viewSessionIDs: readonly string[]
}) {
  if (input.route.name === "session")
    return input.route.sessionID === input.selectedSessionID ? input.selectedSessionID : undefined
  if (input.route.name === "new-session") return input.selectedSessionID
  if (input.route.name !== "views" || !input.focusedViewSessionID) return
  return input.viewSessionIDs.includes(input.focusedViewSessionID) ? input.focusedViewSessionID : undefined
}

export function activeViewForRoute(route: RouteLike, views: ClientCatalogView[]): ClientCatalogView | undefined {
  if (route.name !== "views") return
  if (!route.viewID) return
  return views.find((view) => view.id === route.viewID) ?? views[0]
}

export function activeProjectForRoute(route: RouteLike, projects: GuiSnapshot["projects"]) {
  if (route.name !== "projects") return
  if (!route.projectID) return
  return projects.find((project) => project.id === route.projectID)
}

export function focusedViewItemID(input: {
  localID: string
  persistedID?: string
  items: ViewItem[]
}) {
  if (input.localID && input.items.some((item) => viewItemID(item) === input.localID)) return input.localID
  if (input.persistedID && input.items.some((item) => viewItemID(item) === input.persistedID)) return input.persistedID
  const first = input.items[0]
  return first ? viewItemID(first) : ""
}
