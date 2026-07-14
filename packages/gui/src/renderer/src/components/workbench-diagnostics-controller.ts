import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import {
  workbenchDiagnostics,
  type WorkbenchDiagnosticsResult,
} from "../lib/store"
import { diagnosticMatchesPath, errorText } from "./workbench-page-helpers"
import type { WorkbenchPageProps } from "./workbench-page-types"

export function createWorkbenchDiagnosticsController(input: {
  gui: Accessor<WorkbenchPageProps["gui"]>
  directory: Accessor<string>
  path: Accessor<string>
}) {
  const [diagnostics, setDiagnostics] = createSignal<WorkbenchDiagnosticsResult["diagnostics"]>([])
  const [loading, setLoading] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [command, setCommand] = createSignal("")
  let token = 0

  const active = createMemo(() => diagnostics().filter((item) => diagnosticMatchesPath(item, input.path())))

  createEffect(() => {
    input.directory()
    token++
    setDiagnostics([])
    setMessage("")
    setCommand("")
    setLoading(false)
  })

  async function refresh() {
    const gui = input.gui()
    const directory = input.directory()
    const request = ++token
    if (!gui || !directory || loading()) return
    setLoading(true)
    try {
      const result = await workbenchDiagnostics(gui, directory).catch((err): WorkbenchDiagnosticsResult => ({
        ok: false,
        message: errorText(err, "Unable to run project checks."),
        diagnostics: [],
      }))
      if (request !== token) return
      setDiagnostics(result.diagnostics ?? [])
      setMessage(result.message ?? (result.ok ? "Project checks passed." : "Project checks found issues."))
      setCommand(result.command ?? "")
    } finally {
      if (request === token) setLoading(false)
    }
  }

  return { diagnostics, active, loading, message, command, refresh }
}
