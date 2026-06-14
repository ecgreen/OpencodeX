export type RailRouteName = "dashboard" | "projects" | "swarms" | "views" | "plugins" | "workbench"
export type RailSectionName = "pinned" | "projects" | "recent" | "views"
export type RailDragTarget =
  | { type: "section"; id: RailSectionName }
  | { type: "project"; id: string }
  | { type: "view"; id: string }
export type RailDropTarget = RailDragTarget & { placement: "before" | "after" }
export type RailNavItem = {
  name: RailRouteName
  label: string
  icon: string
  shortcut: string
  description: string
}
