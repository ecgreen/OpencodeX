import { Show, createEffect, createSignal, onMount } from "solid-js"
import type { LucideIcon } from "lucide-solid"

const iconNames = {
  activity: "Activity",
  arrowUp: "ArrowUp",
  branch: "GitBranch",
  browser: "PanelTop",
  check: "Check",
  chevronDown: "ChevronDown",
  chevronLeft: "ChevronLeft",
  chevronRight: "ChevronRight",
  circle: "Circle",
  copy: "Copy",
  dashboard: "LayoutDashboard",
  file: "File",
  folder: "Folder",
  "folder-open": "FolderOpen",
  github: "GitFork",
  grip: "Grip",
  minus: "Minus",
  more: "MoreHorizontal",
  panel: "PanelLeft",
  pencil: "Pencil",
  pin: "Pin",
  play: "Play",
  plus: "Plus",
  save: "Save",
  search: "Search",
  send: "Send",
  session: "MessageSquare",
  settings: "Settings",
  star: "Star",
  stop: "Square",
  swarm: "GitFork",
  trash: "Trash2",
  undo: "Undo2",
  views: "LayoutGrid",
  warning: "TriangleAlert",
  x: "X",
} as const

const iconLoaders: Record<string, () => Promise<{ default: LucideIcon }>> = {
  Activity: () => import("lucide-solid/icons/activity"),
  ArrowUp: () => import("lucide-solid/icons/arrow-up"),
  Check: () => import("lucide-solid/icons/check"),
  ChevronDown: () => import("lucide-solid/icons/chevron-down"),
  ChevronLeft: () => import("lucide-solid/icons/chevron-left"),
  ChevronRight: () => import("lucide-solid/icons/chevron-right"),
  Circle: () => import("lucide-solid/icons/circle"),
  Copy: () => import("lucide-solid/icons/copy"),
  File: () => import("lucide-solid/icons/file"),
  Folder: () => import("lucide-solid/icons/folder"),
  FolderOpen: () => import("lucide-solid/icons/folder-open"),
  GitBranch: () => import("lucide-solid/icons/git-branch"),
  GitFork: () => import("lucide-solid/icons/git-fork"),
  Grip: () => import("lucide-solid/icons/grip"),
  LayoutDashboard: () => import("lucide-solid/icons/layout-dashboard"),
  LayoutGrid: () => import("lucide-solid/icons/layout-grid"),
  MessageSquare: () => import("lucide-solid/icons/message-square"),
  Minus: () => import("lucide-solid/icons/minus"),
  MoreHorizontal: () => import("lucide-solid/icons/more-horizontal"),
  PanelLeft: () => import("lucide-solid/icons/panel-left"),
  PanelTop: () => import("lucide-solid/icons/panel-top"),
  Pencil: () => import("lucide-solid/icons/pencil"),
  Pin: () => import("lucide-solid/icons/pin"),
  Play: () => import("lucide-solid/icons/play"),
  Plus: () => import("lucide-solid/icons/plus"),
  Save: () => import("lucide-solid/icons/save"),
  Search: () => import("lucide-solid/icons/search"),
  Send: () => import("lucide-solid/icons/send"),
  Settings: () => import("lucide-solid/icons/settings"),
  Square: () => import("lucide-solid/icons/square"),
  Star: () => import("lucide-solid/icons/star"),
  Trash2: () => import("lucide-solid/icons/trash-2"),
  TriangleAlert: () => import("lucide-solid/icons/triangle-alert"),
  Undo2: () => import("lucide-solid/icons/undo-2"),
  X: () => import("lucide-solid/icons/x"),
}

const iconCache: Record<string, Promise<LucideIcon>> = {}

export function Icon(props: { name: string; class?: string }) {
  const [graphic, setGraphic] = createSignal<LucideIcon>()

  onMount(() => loadIcon(props.name).then((icon) => setGraphic(() => icon)))

  createEffect(() => {
    if (typeof document === "undefined") return
    loadIcon(props.name).then((icon) => setGraphic(() => icon))
  })

  return (
    <Show
      when={graphic()}
      keyed
      fallback={<span class={props.class ?? "icon"} aria-hidden="true" data-icon={props.name} />}
    >
      {(Graphic) => <Graphic class={props.class ?? "icon"} aria-hidden="true" size={16} strokeWidth={1.9} />}
    </Show>
  )
}

export function DisclosureChevron() {
  return <span class="output-chevron"><Icon name="chevronRight" /></span>
}

function loadIcon(name: string) {
  const iconName = iconNames[name as keyof typeof iconNames] ?? "LayoutDashboard"
  iconCache[iconName] ??= iconLoaders[iconName]().then((module) => module.default)
  return iconCache[iconName]
}
