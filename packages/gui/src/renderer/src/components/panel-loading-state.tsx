import { createSignal, onCleanup, onMount } from "solid-js"

export function PanelLoadingState(props: { label: string }) {
  const [visible, setVisible] = createSignal(false)

  onMount(() => {
    const timer = window.setTimeout(() => setVisible(true), 120)
    onCleanup(() => window.clearTimeout(timer))
  })

  return (
    <div
      class="panel-loading-state"
      classList={{ visible: visible() }}
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <div class="panel-loading-toolbar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div class="panel-loading-content" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span class="panel-loading-label">{props.label}</span>
    </div>
  )
}
