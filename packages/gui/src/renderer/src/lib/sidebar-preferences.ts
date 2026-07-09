import type { RailSectionName } from "../components/rail-sidebar"
import { mergeOrderedIDs } from "./reorder"

export const DEFAULT_RAIL_SECTION_ORDER: RailSectionName[] = ["pinned", "projects", "recent", "prior", "views"]
export const DEFAULT_RAIL_SECTIONS: Record<RailSectionName, boolean> = { pinned: false, projects: false, recent: false, prior: true, views: true }

export type SidebarPreferences = {
  railCollapsed: boolean
  railSectionOrder: RailSectionName[]
  railSections: Record<RailSectionName, boolean>
  expandedProjectIDs: Record<string, boolean>
  pinnedSessionIDs: string[]
  pinnedViewIDs: string[]
}

export function readSidebarPreferences(): SidebarPreferences {
  if (typeof localStorage === "undefined") return defaultSidebarPreferences()
  try {
    const raw = localStorage.getItem("opencodex.gui.sidebar")
    if (!raw) return defaultSidebarPreferences()
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return defaultSidebarPreferences()
    const input = parsed as Record<string, unknown>
    return {
      railCollapsed: typeof input.railCollapsed === "boolean" ? input.railCollapsed : false,
      railSectionOrder: mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, Array.isArray(input.railSectionOrder) ? input.railSectionOrder.filter((value): value is string => typeof value === "string") : []),
      railSections: readRailSections(input.railSections),
      expandedProjectIDs: readBooleanMap(input.expandedProjectIDs),
      pinnedSessionIDs: readStringList(input.pinnedSessionIDs),
      pinnedViewIDs: readStringList(input.pinnedViewIDs),
    }
  } catch {
    return defaultSidebarPreferences()
  }
}

export function writeSidebarPreferences(value: SidebarPreferences) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("opencodex.gui.sidebar", JSON.stringify(value))
  } catch {
    return
  }
}

export function dropPlacement(event: DragEvent): "before" | "after" {
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

function defaultSidebarPreferences(): SidebarPreferences {
  return {
    railCollapsed: false,
    railSectionOrder: DEFAULT_RAIL_SECTION_ORDER,
    railSections: DEFAULT_RAIL_SECTIONS,
    expandedProjectIDs: {},
    pinnedSessionIDs: [],
    pinnedViewIDs: [],
  }
}

function readRailSections(value: unknown): Record<RailSectionName, boolean> {
  if (typeof value !== "object" || value === null) return DEFAULT_RAIL_SECTIONS
  const input = value as Record<string, unknown>
  return {
    pinned: typeof input.pinned === "boolean" ? input.pinned : DEFAULT_RAIL_SECTIONS.pinned,
    projects: typeof input.projects === "boolean" ? input.projects : DEFAULT_RAIL_SECTIONS.projects,
    recent: typeof input.recent === "boolean" ? input.recent : DEFAULT_RAIL_SECTIONS.recent,
    prior: typeof input.prior === "boolean" ? input.prior : DEFAULT_RAIL_SECTIONS.prior,
    views: typeof input.views === "boolean" ? input.views : DEFAULT_RAIL_SECTIONS.views,
  }
}

function readBooleanMap(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string")))
}
