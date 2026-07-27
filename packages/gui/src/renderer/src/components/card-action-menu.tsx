import { Button } from "./ui"
import { For } from "solid-js"
import type { CardContextMenuAction } from "./card-context-menu"
import { Icon } from "./icon"

export function CardActionMenu(props: { label: string; actions: readonly CardContextMenuAction[] }) {
  return (
    <details class="card-action-menu">
      <summary aria-label={`${props.label} actions`} title={`${props.label} actions`}>
        <Icon name="more" />
      </summary>
      <div role="menu">
        <For each={props.actions}>
          {(action) => (
            <Button appearance="ghost"
              type="button"
              role="menuitem"
              tone={action.danger ? "danger" : "neutral"}
              onClick={(event) => {
                const details = event.currentTarget.closest("details")
                if (details) details.open = false
                action.onSelect()
              }}
            >
              <Icon name={action.icon} />
              <span>{action.label}</span>
            </Button>
          )}
        </For>
      </div>
    </details>
  )
}
