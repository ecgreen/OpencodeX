import type { JSX } from "solid-js"
import { Show, createUniqueId, onCleanup, onMount, splitProps } from "solid-js"
import { Portal } from "solid-js/web"
import { IconButton } from "./button"
import { classes } from "./shared"

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: JSX.Element
  description?: JSX.Element
  size?: "sm" | "md" | "lg" | "full"
  footer?: JSX.Element
  /** Wrap the body in a form and submit on Enter. */
  onSubmit?: (event: SubmitEvent) => void
  /** Escape and scrim clicks stop closing the dialog. Use for destructive confirms. */
  dismissible?: boolean
  class?: string
  children: JSX.Element
}

/**
 * The single modal surface. Owns the scrim, focus trap, focus restoration, and
 * Escape behavior so no feature has to reimplement them.
 */
export function Dialog(props: DialogProps) {
  return (
    <Show when={props.open}>
      <Portal>
        <DialogSurface {...props} />
      </Portal>
    </Show>
  )
}

function DialogSurface(props: DialogProps) {
  const [local] = splitProps(props, ["onClose", "title", "description", "size", "footer", "onSubmit", "dismissible", "class", "children"])
  const titleId = createUniqueId()
  const descriptionId = createUniqueId()
  let surface: HTMLDivElement | undefined
  const dismissible = () => local.dismissible !== false

  onMount(() => {
    const restore = document.activeElement as HTMLElement | null
    surface?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible()) {
        event.stopPropagation()
        local.onClose()
        return
      }
      if (event.key !== "Tab" || !surface) return
      const targets = [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (targets.length === 0) return
      const first = targets[0]
      const last = targets.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown, true)
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true)
      restore?.focus?.()
    })
  })

  const body = (
    <>
      <div class="ui-dialog-body">{local.children}</div>
      <Show when={local.footer}>{(footer) => <footer class="ui-dialog-footer">{footer()}</footer>}</Show>
    </>
  )

  // A scrim click only dismisses when the press started on the scrim. Without
  // this, the click that opened the dialog reaches the freshly mounted scrim
  // and closes it immediately, and dragging a selection out of the dialog
  // would dismiss it too.
  let pressedScrim = false

  return (
    <>
      <div
        class="ui-scrim"
        onPointerDown={(event) => { pressedScrim = event.target === event.currentTarget }}
        onClick={(event) => {
          const dismiss = pressedScrim && event.target === event.currentTarget && dismissible()
          pressedScrim = false
          if (dismiss) local.onClose()
        }}
      />
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={local.description ? descriptionId : undefined}
        data-ui="dialog"
        data-size={local.size ?? "md"}
        class={classes("ui-dialog", local.class)}
      >
        <header class="ui-dialog-header">
          <div class="ui-dialog-heading">
            <h2 id={titleId} class="ui-dialog-title">{local.title}</h2>
            <Show when={local.description}>
              {(description) => <p id={descriptionId} class="ui-dialog-description">{description()}</p>}
            </Show>
          </div>
          <Show when={dismissible()}>
            <IconButton appearance="ghost" size="compact" icon="x" label="Close dialog" onClick={local.onClose} />
          </Show>
        </header>
        <Show when={local.onSubmit} fallback={body}>
          <form class="ui-dialog-form" onSubmit={(event) => { event.preventDefault(); local.onSubmit?.(event) }}>
            {body}
          </form>
        </Show>
      </div>
    </>
  )
}

export function DialogFooter(props: { children: JSX.Element; align?: "end" | "between" }) {
  return <div class="ui-dialog-footer" data-align={props.align}>{props.children}</div>
}
