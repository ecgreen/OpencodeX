export type RailRouteName = "dashboard" | "sessions" | "projects" | "views" | "swarms" | "status" | "settings"
export type RailSectionName = "projects" | "recent" | "swarms" | "views"
export type RailDragTarget = { type: "project"; id: string } | { type: "view"; id: string }
export type RailNavItem = {
  name: RailRouteName
  label: string
  icon: string
  shortcut: string
  description: string
}
