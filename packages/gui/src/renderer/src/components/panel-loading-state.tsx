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

export function SessionSidePanelLoading(props: { open: boolean; widthRatio: number }) {
  return (
    <>
      <div class="session-side-panel-resize workspace-panel-loading-resize" classList={{ open: props.open }} aria-hidden="true" />
      <aside
        class="session-side-panel workspace-panel-loading"
        classList={{ open: props.open }}
        style={{ "--session-side-panel-width": `${Math.round(props.widthRatio * 10000) / 100}%` }}
        aria-label="Side panel"
        aria-hidden={!props.open}
        aria-busy="true"
        inert={!props.open}
      >
        <PanelLoadingState label="Loading workspace tools" />
      </aside>
    </>
  )
}
