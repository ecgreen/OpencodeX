import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { registerOverlay } from "../lib/overlay-registry"
import { IconButton } from "./ui"

export function ModalFrame(props: {
  title: string
  description?: string
  close: () => void
  class?: string
  backdropClass?: string
  children: JSX.Element
  footer?: JSX.Element
  onSubmit?: (event: SubmitEvent) => void
  showClose?: boolean
  closeSize?: "compact" | "default" | "prominent"
  autofocusClose?: boolean
  mount?: Node
}) {
  // ModalFrame instances mount only while open, so mounting IS the overlay
  // signal. Parks the native browser view that composites above the DOM.
  registerOverlay()
  const card = () => (
    <>
      <header>
        <div>
          <h2>{props.title}</h2>
          <Show when={props.description}>
            {(description) => <p>{description()}</p>}
          </Show>
        </div>
        <Show when={props.showClose ?? true}>
          <IconButton appearance="ghost" icon="x" label={`Close ${props.title}`} size={props.closeSize} autofocus={props.autofocusClose} onClick={props.close} />
        </Show>
      </header>
      {props.children}
      <Show when={props.footer}>
        {(footer) => footer()}
      </Show>
    </>
  )

  const frame = () => (
    <div
      class={props.backdropClass ?? "dialog-backdrop"}
      onMouseDown={props.close}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        props.close()
      }}
    >
      <Show
        when={props.onSubmit}
        fallback={(
          <section class={props.class ?? "dialog-card"} role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={(event) => event.stopPropagation()}>
            {card()}
          </section>
        )}
      >
        {(onSubmit) => (
          <form class={props.class ?? "dialog-card"} role="dialog" aria-modal="true" aria-label={props.title} onSubmit={onSubmit()} onMouseDown={(event) => event.stopPropagation()}>
            {card()}
          </form>
        )}
      </Show>
    </div>
  )

  return (
    <Show when={props.mount} fallback={frame()}>
      {(mount) => <Portal mount={mount()}>{frame()}</Portal>}
    </Show>
  )
}
