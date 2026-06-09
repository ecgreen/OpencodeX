import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"
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

export function activeViewForRoute(route: RouteLike, views: OpencodeXView[]): OpencodeXView | undefined {
  if (route.name !== "views") return
  return views.find((view) => view.id === route.viewID) ?? views[0]
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
