import type { JSX } from "solid-js"
import { Show } from "solid-js"
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
}) {
  const card = () => (
    <>
      <header>
        <div>
          <h2>{props.title}</h2>
          <Show when={props.description}>
            {(description) => <p>{description()}</p>}
          </Show>
        </div>
        <IconButton icon="x" label={`Close ${props.title}`} onClick={props.close} />
      </header>
      {props.children}
      <Show when={props.footer}>
        {(footer) => footer()}
      </Show>
    </>
  )

  return (
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
          <section class={props.class ?? "dialog-card"} onMouseDown={(event) => event.stopPropagation()}>
            {card()}
          </section>
        )}
      >
        {(onSubmit) => (
          <form class={props.class ?? "dialog-card"} onSubmit={onSubmit()} onMouseDown={(event) => event.stopPropagation()}>
            {card()}
          </form>
        )}
      </Show>
    </div>
  )
}
