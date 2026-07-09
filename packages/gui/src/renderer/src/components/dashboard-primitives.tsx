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

export function DashboardSection(props: { title: string; count: number; action?: string; onAction?: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-section">
      <header>
        <div>
          <strong class="dashboard-section-title">{props.title} <span class="section-count">({props.count})</span></strong>
        </div>
        <Show when={props.action && props.onAction}>
          <button class="secondary" onClick={props.onAction}>{props.action}</button>
        </Show>
      </header>
      <div class="dashboard-section-content">
        <div>{props.children}</div>
      </div>
    </section>
  )
}

export function EmptyCreateDashboardCard(props: { title: string; description: string; onClick: () => void }) {
  return (
    <button class="dashboard-empty-state dashboard-empty-action" onClick={props.onClick}>
      <span><Icon name="plus" /></span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
    </button>
  )
}

export function Empty(props: { text: string }) {
  return (
    <div class="dashboard-empty-state">
      <span><Icon name="dashboard" /></span>
      <strong>{props.text}</strong>
    </div>
  )
}
