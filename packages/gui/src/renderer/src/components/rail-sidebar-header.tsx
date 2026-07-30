import { Mark } from "@opencode-ai/ui/logo"
import { For, Show } from "solid-js"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/session-api"
import { Icon } from "./icon"
import type { RailNavItem, RailRouteName } from "./rail-sidebar-types"
import { Button, IconButton } from "./ui"

export function RailBrand(props: {
  snapshot?: GuiSnapshot
  railCollapsed: boolean
  openDashboard: () => void
  toggleRail: () => void
  createSession: () => void
}) {
  return (
    <div class="brand" onClick={props.openDashboard}>
      <span class="brand-mark">
        <Mark />
      </span>
      <div class="brand-copy">
        <strong>OpencodeX</strong>
        <span>
          {props.snapshot?.projects[0]
            ? title(props.snapshot.projects[0].name ?? props.snapshot.projects[0].project.name)
            : "Command center"}
        </span>
      </div>
      <div class="brand-actions">
        <IconButton
          appearance="ghost"
          icon="panel"
          label="Toggle sidebar"
          class="rail-toggle"
          title={`${props.railCollapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
          aria-expanded={!props.railCollapsed}
          onClick={(event) => {
            event.stopPropagation()
            props.toggleRail()
          }}
        />
        <Show when={props.railCollapsed}>
          <IconButton
            appearance="ghost"
            icon="plus"
            label="New session"
            class="new-button"
            title="New session (Ctrl+N)"
            onClick={(event) => {
              event.stopPropagation()
              props.createSession()
            }}
          />
        </Show>
      </div>
    </div>
  )
}

export function RailNav(props: {
  items: readonly RailNavItem[]
  badges: Record<string, number>
  activeRouteName: string
  collapsed: boolean
  openRoute: (name: RailRouteName) => void
}) {
  return (
    <nav class="nav" classList={{ "nav-collapsed": props.collapsed }}>
      <For each={props.items}>
        {(item) => {
          const badge = () => props.badges[item.name] ?? 0
          return (
            <Button
              appearance="ghost"
              aria-label={`${item.label}: ${item.description}${badge() > 0 ? `, ${badge()} need attention` : ""}`}
              title={`${item.label}: ${item.description} (${item.shortcut})`}
              classList={{ active: props.activeRouteName === item.name }}
              onClick={() => props.openRoute(item.name)}
            >
              <Icon name={item.icon} />
              <span class="nav-label">{item.label}</span>
              <Show when={badge() > 0}>
                <span class="nav-badge" aria-hidden="true">
                  {badge()}
                </span>
              </Show>
            </Button>
          )
        }}
      </For>
    </nav>
  )
}
