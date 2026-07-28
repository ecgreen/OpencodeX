import { Show, createEffect, createSignal } from "solid-js"
import { BrowserHostFallback } from "./browser-host-fallback"
import type { NativeBrowserLifecycle } from "./native-browser-controller"

export function SessionSideBrowserHost(props: {
  preview?: string
  parked: boolean
  available: boolean
  lifecycle: NativeBrowserLifecycle
  error: string
  url: string
  setHost: (element: HTMLDivElement) => void
}) {
  // A stale or truncated preview data-URL renders as the browser's broken-image
  // glyph. Treat a failed preview as no preview, so the proper empty state
  // shows instead.
  const [previewFailed, setPreviewFailed] = createSignal(false)
  createEffect(() => {
    props.preview
    setPreviewFailed(false)
  })
  const preview = () => (previewFailed() ? undefined : props.preview)
  return (
    <div class="session-side-browser-host" ref={props.setHost}>
      <Show when={preview()}>{(src) => <img class="session-side-browser-preview" src={src()} alt="" onError={() => setPreviewFailed(true)} />}</Show>
      <Show when={props.parked && !preview()}><div class="session-side-browser-preview empty" aria-hidden="true" /></Show>
      <BrowserHostFallback
        visible={!preview() && (!props.available || props.lifecycle === "error" || props.lifecycle === "creating" || !props.url)}
        busy={props.lifecycle === "creating"}
        title={!props.available ? "Desktop browser unavailable" : props.lifecycle === "error" ? "Page unavailable" : props.lifecycle === "creating" ? "Starting browser" : "Open a webpage"}
        message={!props.available ? undefined : props.lifecycle === "error" ? props.error : props.lifecycle === "creating" ? "Creating an isolated browser surface…" : "Enter an address above to inspect a webpage in this session."}
      />
    </div>
  )
}
