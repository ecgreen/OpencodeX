import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  workbenchFileDiagnostics,
  type WorkbenchFileDiagnosticsResult,
} from "../lib/session-api"

export function createWorkbenchDiagnosticsController(input: {
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  root: Accessor<string | undefined>
  path: Accessor<string>
  content: Accessor<string>
}) {
  const [diagnostics, setDiagnostics] = createSignal<WorkbenchFileDiagnosticsResult["diagnostics"]>([])
  const [loading, setLoading] = createSignal(false)
  const [checkerMessage, setCheckerMessage] = createSignal("")
  const [checkerSupported, setCheckerSupported] = createSignal(true)
  const [languageMessage, setLanguageMessage] = createSignal("")
  const supported = createMemo(() => checkerSupported() && !languageMessage())
  const message = createMemo(() => languageMessage() || checkerMessage())
  let controller: AbortController | undefined
  let token = 0

  createEffect(() => {
    const directory = input.directory()
    input.root()
    const path = input.path()
    token++
    controller?.abort()
    setDiagnostics([])
    setCheckerMessage("")
    setLanguageMessage("")
    setLoading(false)
    setCheckerSupported(true)
    if (directory && path) untrack(() => void refresh())
  })

  onCleanup(() => controller?.abort())

  async function refresh() {
    const gui = input.gui()
    const directory = input.directory()
    const path = input.path()
    if (!gui || !directory || !path) return
    const request = ++token
    controller?.abort()
    controller = new AbortController()
    setLoading(true)
    try {
      const result = await workbenchFileDiagnostics(gui, {
        path,
        root: input.root(),
        content: input.content(),
        signal: controller.signal,
      }, directory).catch((err): WorkbenchFileDiagnosticsResult => ({
        ok: false,
        supported: true,
        message: err instanceof Error ? err.message : "Unable to check this file.",
        diagnostics: [],
      }))
      if (request !== token) return
      setDiagnostics(result.diagnostics ?? [])
      setCheckerSupported(result.supported)
      setCheckerMessage(result.message ?? "")
    } finally {
      if (request === token) setLoading(false)
    }
  }

  function setLanguageStatus(value: boolean, detail?: string) {
    setLanguageMessage(value ? "" : detail || "Language intelligence is unavailable.")
  }

  return { diagnostics, active: diagnostics, loading, message, supported, refresh, setLanguageStatus }
}
