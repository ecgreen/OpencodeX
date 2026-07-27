import { Show } from "solid-js"
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
  return (
    <div class="session-side-browser-host" ref={props.setHost}>
      <Show when={props.preview}>{(src) => <img class="session-side-browser-preview" src={src()} alt="" />}</Show>
      <Show when={props.parked && !props.preview}><div class="session-side-browser-preview empty" aria-hidden="true" /></Show>
      <BrowserHostFallback
        visible={!props.preview && (!props.available || props.lifecycle === "error" || props.lifecycle === "creating" || !props.url)}
        busy={props.lifecycle === "creating"}
        title={!props.available ? "Desktop browser unavailable" : props.lifecycle === "error" ? "Page unavailable" : props.lifecycle === "creating" ? "Starting browser" : "Open a webpage"}
        message={!props.available ? undefined : props.lifecycle === "error" ? props.error : props.lifecycle === "creating" ? "Creating an isolated browser surface…" : "Enter an address above to inspect a webpage in this session."}
      />
    </div>
  )
}
