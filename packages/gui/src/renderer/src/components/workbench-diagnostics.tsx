import { Button } from "./ui"

export function WorkbenchDiagnosticsBar(props: {
  loading: boolean
  supported: boolean
  message: string
  total: number
  onRun: () => void
}) {
  return (
    <div class="workbench-diagnostics-bar" classList={{ loading: props.loading }} role="status" aria-live="polite">
      <span>{workbenchDiagnosticsSummary(props)}</span>
      <Button appearance="ghost" size="compact" disabled={props.loading} onClick={props.onRun}>Check file</Button>
    </div>
  )
}

export function workbenchDiagnosticsSummary(input: { loading: boolean; supported: boolean; message: string; total: number }) {
  if (input.loading) return "Checking file…"
  if (input.message) return input.message
  if (!input.supported) return "No file checker available"
  if (input.total > 0) return `${input.total} issue${input.total === 1 ? "" : "s"} in this file`
  return "No issues in this file"
}
