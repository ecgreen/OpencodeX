import { Show } from "solid-js"
import { Icon } from "./icon"

export function BrowserHostFallback(props: { visible: boolean }) {
  return (
    <Show when={props.visible}>
      <div class="browser-host-fallback" role="status">
        <Icon name="browser" />
        <strong>Desktop browser unavailable</strong>
        <span>Open this workspace in the OpencodeX desktop app to render and inspect webpages.</span>
      </div>
    </Show>
  )
}
