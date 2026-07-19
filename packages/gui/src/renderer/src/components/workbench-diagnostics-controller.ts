import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  workbenchDiagnostics,
  type WorkbenchDiagnostic,
  type WorkbenchDiagnosticsResult,
} from "../lib/store"
import { workbenchPathKey } from "../lib/workbench"

export function createWorkbenchDiagnosticsController(input: {
  gui: Accessor<GuiClient | undefined>
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
    if (!gui || !directory || loading()) return
    const request = ++token
    setLoading(true)
    try {
      const result = await workbenchDiagnostics(gui, directory).catch((err): WorkbenchDiagnosticsResult => ({
        ok: false,
        message: err instanceof Error ? err.message : "Unable to run project checks.",
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

function diagnosticMatchesPath(diagnostic: WorkbenchDiagnostic, path: string) {
  const left = workbenchPathKey(diagnostic.path)
  const right = workbenchPathKey(path)
  if (!left || !right) return false
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}
