import { Button } from "./ui"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Icon } from "./icon"

export function DashboardActionCard(props: { title: string; description: string; meta: string; tone: "project" | "session" | "swarm" | "view"; icon: string; onClick: () => void }) {
  return (
    <Button appearance="ghost" class={`dashboard-action-card ${props.tone}`} onClick={props.onClick}>
      <span class="action-plus"><Icon name={props.icon} /></span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
      <small>{props.meta}</small>
    </Button>
  )
}

export function DashboardSection(props: { title: string; count: number; action?: string; actionLabel?: string; onAction?: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-section">
      <header>
        <div>
          <h2 class="dashboard-section-title">{props.title} <span class="section-count">({props.count})</span></h2>
        </div>
        <Show when={props.action && props.onAction}>
          <Button appearance="outline" icon="plus" aria-label={props.actionLabel ?? props.action} onClick={props.onAction}>{props.action}</Button>
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
    <Button appearance="ghost" class="dashboard-empty-state dashboard-empty-action" onClick={props.onClick}>
      <span><Icon name="plus" /></span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
    </Button>
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
