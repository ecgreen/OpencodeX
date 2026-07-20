import { afterEach, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createWorkbenchDiagnosticsController } from "../src/renderer/src/components/workbench-diagnostics-controller"
import { workbenchDiagnosticsSummary } from "../src/renderer/src/components/workbench-diagnostics"
import type { GuiClient } from "../src/renderer/src/lib/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test("language intelligence failures remain visible in the footer", () => {
  expect(workbenchDiagnosticsSummary({ loading: false, supported: false, message: "Language intelligence is unavailable.", total: 0 }))
    .toBe("Language intelligence is unavailable.")
})

test("file diagnostic requests abort and ignore stale tab responses", async () => {
  const requests: Array<{ signal?: AbortSignal; resolve: (response: Response) => void }> = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
    requests.push({ signal: input instanceof Request ? input.signal : init?.signal ?? undefined, resolve })
  })) as typeof fetch
  const [path, setPath] = createSignal("src/old.ts")
  let dispose = () => undefined
  const controller = createRoot((cleanup) => {
    dispose = cleanup
    return createWorkbenchDiagnosticsController({
      gui: () => ({
        url: "http://127.0.0.1:4096",
        directory: "C:/repo",
        authHeader: "",
        client: createOpencodeClient({ baseUrl: "http://127.0.0.1:4096", directory: "C:/repo" }),
      } as GuiClient),
      directory: () => "C:/repo",
      root: () => "C:/dependencies/pkg",
      path,
      content: () => `content:${path()}`,
    })
  })

  try {
    await waitFor(() => requests.length === 1)
    setPath("src/new.ts")
    await waitFor(() => requests.length === 2)
    expect(requests[0]?.signal?.aborted).toBe(true)
    requests[1]?.resolve(jsonResponse({
      ok: true,
      supported: true,
      diagnostics: [{ path: "src/new.ts", line: 1, severity: "warning", message: "new" }],
    }))
    await waitFor(() => controller.diagnostics()[0]?.message === "new")
    requests[0]?.resolve(jsonResponse({
      ok: true,
      supported: true,
      diagnostics: [{ path: "src/old.ts", line: 1, severity: "error", message: "stale" }],
    }))
    await Promise.resolve()
    expect(controller.diagnostics()[0]?.message).toBe("new")
  } finally {
    dispose()
  }
})

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })
}

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 250 })) {
    if (predicate()) return
    await Bun.sleep(2)
  }
  throw new Error("Timed out waiting for controller state")
}
