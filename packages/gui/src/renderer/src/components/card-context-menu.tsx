import { Button } from "./ui"
import type { JSX } from "solid-js"
import { For, Show, createSignal, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "./icon"

export type CardContextMenuAction = {
  label: string
  icon: string
  danger?: boolean
  onSelect: () => void
}

export function CardContextMenu(props: {
  actions: readonly CardContextMenuAction[]
  children: (open: (event: MouseEvent) => void) => JSX.Element
}) {
  const [position, setPosition] = createSignal<{ x: number; y: number }>()

  function close() {
    window.removeEventListener("click", close)
    window.removeEventListener("keydown", keyDown)
    window.removeEventListener("scroll", close, true)
    setPosition(undefined)
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === "Escape") close()
  }

  function open(event: MouseEvent) {
    if (props.actions.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    close()
    setPosition({
      x: event.clientX,
      y: event.clientY,
    })
    window.addEventListener("click", close)
    window.addEventListener("keydown", keyDown)
    window.addEventListener("scroll", close, true)
  }

  function select(action: CardContextMenuAction) {
    close()
    action.onSelect()
  }

  onCleanup(close)

  return (
    <>
      {props.children(open)}
      <Show when={position()}>
        {(position) => (
          <Portal>
            <div
              class="card-context-menu"
              role="menu"
              style={{ left: `${position().x}px`, top: `${position().y}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              <For each={props.actions}>
                {(action) => (
                  <Button appearance="ghost" tone={action.danger ? "danger" : "neutral"} type="button" role="menuitem" onClick={() => select(action)}>
                    <Icon name={action.icon} />
                    <span>{action.label}</span>
                  </Button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
