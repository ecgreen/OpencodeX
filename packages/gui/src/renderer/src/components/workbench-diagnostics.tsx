import type { WorkbenchDiagnostic } from "../lib/store"
import { For, Show, createMemo } from "solid-js"
import { Icon } from "./icon"
import { IconButton } from "./ui"

export function WorkbenchDiagnosticsBar(props: {
  loading: boolean
  message: string
  command: string
  diagnostics: WorkbenchDiagnostic[]
  total: number
  onOpen: (path: string) => void
  onFix: (diagnostic: WorkbenchDiagnostic) => void
}) {
  const visible = createMemo(() => props.diagnostics.slice(0, 4))
  const shouldShow = createMemo(() => props.loading || props.total > 0 || (props.message && props.message !== "Project checks passed."))
  return (
    <Show when={shouldShow()}>
      <div class="workbench-diagnostics-bar" classList={{ loading: props.loading, clean: !props.loading && props.total === 0 }}>
        <div class="workbench-diagnostics-summary">
          <Icon name={props.total > 0 ? "warning" : "check"} />
          <span>{props.loading ? "Running project checks..." : props.total > 0 ? `${props.total} project issue${props.total === 1 ? "" : "s"}` : props.message}</span>
          <Show when={props.command}>
            <small>{props.command}</small>
          </Show>
        </div>
        <For each={visible()}>
          {(item) => (
            <div class={`workbench-diagnostic-row ${item.severity}`}>
              <button type="button" disabled={!item.path} onClick={() => item.path ? props.onOpen(item.path) : undefined}>
                <span>{item.severity}</span>
                <strong>{item.path ? `${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}` : "Project"}</strong>
                <em>{item.message}</em>
              </button>
              <IconButton
                class="workbench-diagnostic-fix"
                icon="arrowUp"
                label="Ask model to fix diagnostic"
                onClick={() => props.onFix(item)}
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
