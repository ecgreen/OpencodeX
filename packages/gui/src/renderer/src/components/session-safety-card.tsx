import { Show } from "solid-js"
import { Icon } from "./icon"
import { IconButton } from "./ui"

export type SafetyQueuePosition = {
  /** Zero-based position within the active group (permissions or questions). */
  index: number
  /** Size of the active group. */
  total: number
  /** The other group still queued behind this one, e.g. "2 questions". */
  upNext?: string
  /** True when the full queue has more than one entry to page through. */
  canNavigate: boolean
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
  const positionText = () => (props.position.total > 1 ? `${props.position.index + 1} of ${props.position.total}` : "1 request")
  const description = () =>
    [`Request ${props.position.index + 1} of ${props.position.total} awaiting your input`, props.position.upNext ? `then ${props.position.upNext}` : ""]
      .filter(Boolean)
      .join(", ")
  return (
    <header class="safety-card-header">
      <div class="safety-card-heading">
        <span class="safety-card-icon"><Icon name={props.icon} /></span>
        <div>
          <p class="safety-card-label">{props.label}</p>
          <h2 id={props.titleID}>{props.title}</h2>
        </div>
      </div>
      {/* The one pagination surface: group-relative count, arrows over the whole
          queue, and a hint for the group waiting behind this one. */}
      <div class="safety-queue" aria-label={description()}>
        <Show when={props.position.canNavigate}>
          <IconButton appearance="ghost" size="compact" icon="chevronLeft" label="Previous request" onClick={props.position.previous} />
        </Show>
        <span class="safety-queue-count">{positionText()}</span>
        <Show when={props.position.upNext}>
          {(upNext) => <span class="safety-queue-more">+{upNext()}</span>}
        </Show>
        <Show when={props.position.canNavigate}>
          <IconButton appearance="ghost" size="compact" icon="chevronRight" label="Next request" onClick={props.position.next} />
        </Show>
      </div>
    </header>
  )
}
