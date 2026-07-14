import { Show } from "solid-js"
import { BrowserHostFallback } from "./browser-host-fallback"

export function SessionSideBrowserHost(props: {
  preview?: string
  parked: boolean
  available: boolean
  setHost: (element: HTMLDivElement) => void
}) {
  return (
    <div class="session-side-browser-host" ref={props.setHost}>
      <Show when={props.preview}>{(src) => <img class="session-side-browser-preview" src={src()} alt="" />}</Show>
      <Show when={props.parked && !props.preview}><div class="session-side-browser-preview empty" aria-hidden="true" /></Show>
      <BrowserHostFallback visible={!props.available && !props.preview} />
    </div>
  )
}
