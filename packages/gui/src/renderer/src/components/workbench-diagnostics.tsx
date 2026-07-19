import type { WorkbenchDiagnostic } from "../lib/store"
import { For, Show, createMemo } from "solid-js"
import { Icon } from "./icon"
import { Button, IconButton } from "./ui"

export function WorkbenchDiagnosticsBar(props: {
  loading: boolean
  message: string
  command: string
  diagnostics: WorkbenchDiagnostic[]
  total: number
  onRun: () => void
  onOpen: (path: string) => void
  onFix?: (diagnostic: WorkbenchDiagnostic) => void
}) {
  const visible = createMemo(() => props.diagnostics.slice(0, 4))
  return (
    <div class="workbench-diagnostics-bar" classList={{ loading: props.loading, clean: !props.loading && props.total === 0 }}>
        <div class="workbench-diagnostics-summary">
          <Icon name={props.total > 0 ? "warning" : "check"} />
          <span>{props.loading ? "Running project checks..." : props.total > 0 ? `${props.total} project issue${props.total === 1 ? "" : "s"}` : props.message || "Project checks run on demand."}</span>
          <Show when={props.command}>
            <small>{props.command}</small>
          </Show>
          <IconButton
            class="workbench-diagnostics-run"
            icon="activity"
            label={props.loading ? "Project checks running" : "Run project checks"}
            disabled={props.loading}
            onClick={props.onRun}
          />
        </div>
        <For each={visible()}>
          {(item) => (
            <div class={`workbench-diagnostic-row ${item.severity}`}>
              <Button appearance="ghost" type="button" disabled={!item.path} onClick={() => item.path ? props.onOpen(item.path) : undefined}>
                <span>{item.severity}</span>
                <strong>{item.path ? `${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}` : "Project"}</strong>
                <em>{item.message}</em>
              </Button>
              <Show when={props.onFix}>
                {(fix) => <IconButton class="workbench-diagnostic-fix" icon="arrowUp" label="Ask model to fix diagnostic" onClick={() => fix()(item)} />}
              </Show>
            </div>
          )}
        </For>
    </div>
  )
}
