import { Show } from "solid-js"
import { Icon } from "./icon"
import { IconButton } from "./ui"

export type SafetyQueuePosition = {
  index: number
  total: number
  previous: () => void
  next: () => void
}

export function SafetyCardHeader(props: {
  icon: string
  label: string
  title: string
  titleID: string
  position: SafetyQueuePosition
}) {
  return (
    <header class="safety-card-header">
      <div class="safety-card-heading">
        <span class="safety-card-icon"><Icon name={props.icon} /></span>
        <div>
          <p class="safety-card-label">{props.label}</p>
          <h2 id={props.titleID}>{props.title}</h2>
        </div>
      </div>
      <Show when={props.position.total > 1}>
        <div class="safety-queue" aria-label={`Request ${props.position.index + 1} of ${props.position.total}`}>
          <IconButton appearance="ghost" size="compact" icon="chevronLeft" label="Previous request" onClick={props.position.previous} />
          <span>{props.position.index + 1} of {props.position.total}</span>
          <IconButton appearance="ghost" size="compact" icon="chevronRight" label="Next request" onClick={props.position.next} />
        </div>
      </Show>
    </header>
  )
}
