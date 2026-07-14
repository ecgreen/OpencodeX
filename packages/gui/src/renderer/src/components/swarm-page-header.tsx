import { For } from "solid-js"
import { Button } from "./ui"

export function SwarmPageHeader(props: {
  eyebrow: string
  title: string
  description: string
  actions: Array<{ label: string; icon: string; danger?: boolean; onClick: () => void | Promise<void> }>
}) {
  return (
    <header class="manager-page-header">
      <div>
        <p class="eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      <div class="row-actions">
        <For each={props.actions}>
          {(action) => <Button variant={action.danger ? "danger" : "secondary"} icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
        </For>
      </div>
    </header>
  )
}
