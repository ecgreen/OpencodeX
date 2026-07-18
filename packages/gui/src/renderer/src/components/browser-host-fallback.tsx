import { Show } from "solid-js"
import { Icon } from "./icon"

export function BrowserHostFallback(props: { visible: boolean; title?: string; message?: string; busy?: boolean }) {
  return (
    <Show when={props.visible}>
      <div class="browser-host-fallback" role="status" aria-busy={props.busy}>
        <Icon name="browser" />
        <strong>{props.title ?? "Desktop browser unavailable"}</strong>
        <span>{props.message ?? "Open this workspace in the OpencodeX desktop app to render and inspect webpages."}</span>
      </div>
    </Show>
  )
}
