import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Icon } from "./icon"

export function DashboardActionCard(props: { title: string; description: string; meta: string; tone: "project" | "session" | "swarm" | "view"; icon: string; onClick: () => void }) {
  return (
    <button class={`dashboard-action-card ${props.tone}`} onClick={props.onClick}>
      <span class="action-plus"><Icon name={props.icon} /></span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
      <small>{props.meta}</small>
    </button>
  )
}

export function DashboardSection(props: { title: string; count: number; collapsed: boolean; onToggle: () => void; action?: string; onAction?: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-section">
      <header>
        <div>
          <button class="section-collapse" aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.title}`} aria-expanded={!props.collapsed} onClick={props.onToggle}>
            <span class="section-chevron"><Icon name={props.collapsed ? "chevronRight" : "chevronDown"} /></span>
            <strong>{props.title} <span class="section-count">({props.count})</span></strong>
          </button>
        </div>
        <Show when={props.action && props.onAction}>
          <button class="secondary" onClick={props.onAction}>{props.action}</button>
        </Show>
      </header>
      <div class="dashboard-section-content" classList={{ collapsed: props.collapsed }}>
        <div>{props.children}</div>
      </div>
    </section>
  )
}

export function EmptyCreateDashboardCard(props: { title: string; description: string; onClick: () => void }) {
  return (
    <button class="dashboard-item-card empty-create interactive" onClick={props.onClick}>
      <strong><Icon name="plus" /> {props.title}</strong>
      <span>{props.description}</span>
      <small>create</small>
    </button>
  )
}

export function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
