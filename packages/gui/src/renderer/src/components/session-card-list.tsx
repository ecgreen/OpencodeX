import { Button } from "./ui"
import { isRecentClientSessionUpdate } from "@opencode-ai/sdk/v2/session-order"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Empty } from "./dashboard-primitives"
import { Icon } from "./icon"

export function SessionCardBucket(props: { title: string; count: number; empty: string; collapsed: boolean; onToggle: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-session-bucket">
      <header>
        <Button appearance="ghost" class="dashboard-bucket-toggle" aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.title}`} aria-expanded={!props.collapsed} onClick={props.onToggle}>
          <Icon name={props.collapsed ? "chevronRight" : "chevronDown"} />
          <strong>{props.title}</strong>
        </Button>
        <small>{props.count}</small>
      </header>
      <div class="dashboard-bucket-content" classList={{ collapsed: props.collapsed }}>
        <div class="dashboard-card-grid compact">
          <Show when={!props.collapsed}>
            <Show when={props.count > 0} fallback={<Empty text={props.empty} />}>
              {props.children}
            </Show>
          </Show>
        </div>
      </div>
    </section>
  )
}

export function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return isRecentClientSessionUpdate(timeUpdated, now)
}
