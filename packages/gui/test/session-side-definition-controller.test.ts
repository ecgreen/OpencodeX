import { afterEach, describe, expect, test } from "bun:test"
import { createMemo, createRoot, createSignal } from "solid-js"
import { createSessionSideDefinitionController } from "../src/renderer/src/components/session-side-definition-controller"
import type { OpenFileTarget, OpenTab } from "../src/renderer/src/components/session-side-open-types"
import type { GuiClient } from "../src/renderer/src/lib/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe("session file definition navigation", () => {
  test("reveals same-file definitions without creating a tab", async () => {
    globalThis.fetch = definitionFetch([{ path: "src/app.ts", line: 3, column: 7, endLine: 3, endColumn: 12 }])
    const state = definitionState([fileTab("active", "src/app.ts")], "active")
    await state.controller.open({ line: 8, column: 4 })

    expect(state.created).toEqual([])
    expect(state.controller.navigation()).toEqual({ path: "src/app.ts", line: 3, column: 7, endLine: 3, endColumn: 12, token: 2 })
    state.dispose()
  })

  test("reuses an existing cross-file tab before revealing its range", async () => {
    globalThis.fetch = definitionFetch([{ path: "src/value.ts", line: 2, column: 1, endLine: 2, endColumn: 6 }])
    const state = definitionState([fileTab("active", "src/app.ts"), fileTab("target", "src/value.ts")], "active")
    await state.controller.open({ line: 1, column: 1 })

    expect(state.activeID()).toBe("target")
    expect(state.created).toEqual([])
    expect(state.controller.navigation()?.path).toBe("src/value.ts")
    state.dispose()
  })

  test("leaves tabs unchanged when the tab limit rejects a new definition target", async () => {
    globalThis.fetch = definitionFetch([{ path: "src/missing.ts", line: 1, column: 1, endLine: 1, endColumn: 4 }])
    const state = definitionState([fileTab("active", "src/app.ts")], "active", true)
    await state.controller.open({ line: 1, column: 1 })

    expect(state.activeID()).toBe("active")
    expect(state.controller.navigation()).toBeUndefined()
    state.dispose()
  })

  test("ignores a definition response after the user switches tabs", async () => {
    let resolve = (_response: Response) => undefined
    let begin = () => undefined
    const started = new Promise<void>((done) => { begin = done })
    globalThis.fetch = (() => {
      begin()
      return new Promise<Response>((done) => { resolve = done })
    }) as typeof fetch
    const state = definitionState([fileTab("active", "src/app.ts"), fileTab("other", "src/other.ts")], "active")
    const pending = state.controller.open({ line: 1, column: 1 })
    await started
    state.select("other")
    resolve(new Response(JSON.stringify([{ path: "src/value.ts", line: 1, column: 1, endLine: 1, endColumn: 4 }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    await pending

    expect(state.activeID()).toBe("other")
    expect(state.controller.navigation()).toBeUndefined()
    state.dispose()
  })

  test("loads hover details for the active unsaved file", async () => {
    let body: Record<string, unknown> | undefined
    globalThis.fetch = (async (input, init) => {
      body = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        supported: true,
        contents: [{ kind: "code", language: "typescript", value: "const value: number" }],
        definitions: [{ path: "src/value.ts", line: 2, column: 1, endLine: 2, endColumn: 6 }],
        range: { line: 1, column: 7, endLine: 1, endColumn: 12 },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch
    const state = definitionState([fileTab("active", "src/app.ts")], "active")
    const hover = await state.controller.hover({ line: 1, column: 9 })

    expect(body).toEqual({ path: "src/app.ts", content: "const value = 1", line: 1, column: 9 })
    expect(hover?.contents[0]?.value).toBe("const value: number")
    expect(hover?.definitions[0]?.path).toBe("src/value.ts")
    state.dispose()
  })

  test("ignores hover details after the user switches files", async () => {
    let resolve = (_response: Response) => undefined
    let begin = () => undefined
    const started = new Promise<void>((done) => { begin = done })
    globalThis.fetch = (() => {
      begin()
      return new Promise<Response>((done) => { resolve = done })
    }) as typeof fetch
    const state = definitionState([fileTab("active", "src/app.ts"), fileTab("other", "src/other.ts")], "active")
    const pending = state.controller.hover({ line: 1, column: 9 })
    await started
    state.select("other")
    resolve(new Response(JSON.stringify({ supported: true, contents: [{ kind: "plaintext", value: "stale" }], definitions: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))

    expect(await pending).toBeUndefined()
    state.dispose()
  })

  test("opens dependency definitions with root identity and read-only metadata", async () => {
    let requestURL = ""
    globalThis.fetch = (async (input) => {
      requestURL = input instanceof Request ? input.url : String(input)
      return new Response(JSON.stringify([{ path: "index.d.ts", root: "C:/cache/pkg", readOnly: true, line: 4, column: 2, endLine: 4, endColumn: 8 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
    const state = definitionState([fileTab("active", "src/app.ts"), fileTab("workspace", "index.d.ts")], "active")
    await state.controller.open({ line: 1, column: 2 })

    expect(state.activeID()).toBe("created-1")
    expect(state.opened[0]).toMatchObject({ path: "index.d.ts", directory: "C:/repo", root: "C:/cache/pkg", readOnly: true })
    expect(new URL(requestURL).searchParams.get("directory")).toBe("C:/repo")
    expect(state.controller.navigation()).toMatchObject({ path: "index.d.ts", root: "C:/cache/pkg", readOnly: true })
    state.dispose()
  })

  test("upgrades a reused dependency tab to read-only", async () => {
    globalThis.fetch = definitionFetch([{ path: "index.d.ts", root: "C:/cache/pkg", readOnly: true, line: 1, column: 1, endLine: 1, endColumn: 5 }])
    const dependency = { ...fileTab("dependency", "index.d.ts"), root: "C:/cache/pkg" }
    const state = definitionState([fileTab("active", "src/app.ts"), dependency], "active")
    await state.controller.open({ line: 1, column: 2 })

    expect(state.activeID()).toBe("dependency")
    expect(state.tabs().find((tab) => tab.id === "dependency")?.readOnly).toBe(true)
    expect(state.opened).toEqual([])
    state.dispose()
  })

  test("reports unsupported hover without returning stale tooltip content", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      supported: false,
      message: "Language intelligence is unavailable.",
      contents: [],
      definitions: [],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch
    const state = definitionState([fileTab("active", "src/app.ts")], "active")

    expect((await state.controller.hover({ line: 1, column: 2 }))?.supported).toBe(false)
    expect(state.languageStatus).toEqual([{ supported: false, message: "Language intelligence is unavailable." }])
    state.dispose()
  })
})

function definitionState(initial: OpenTab[], initialID: string, rejectCreate = false) {
  const [tabs, setTabs] = createSignal(initial)
  const [activeID, setActiveID] = createSignal(initialID)
  const activeTab = createMemo(() => tabs().find((tab) => tab.id === activeID()))
  const created: string[] = []
  const opened: OpenFileTarget[] = []
  const languageStatus: Array<{ supported: boolean; message?: string }> = []
  let dispose = () => undefined
  const controller = createRoot((cleanup) => {
    dispose = cleanup
    return createSessionSideDefinitionController({
      gui: () => ({
        url: "http://127.0.0.1:4096",
        directory: "C:/repo",
        authHeader: "",
        client: createOpencodeClient({ baseUrl: "http://127.0.0.1:4096", directory: "C:/repo" }),
      } as GuiClient),
      directory: () => "C:/repo",
      tabs,
      activeTab,
      selectTab: setActiveID,
      updateTab: (id, patch) => setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab)),
      createTab: (patch) => {
        if (rejectCreate) return
        const id = `created-${created.length + 1}`
        created.push(id)
        setTabs((current) => [...current, { ...fileTab(id, patch.input ?? ""), ...patch }])
        setActiveID(id)
        return id
      },
      openFile: async (_id, target) => { opened.push(target) },
      languageStatus: (supported, message) => languageStatus.push({ supported, message }),
    })
  })
  return { controller, tabs, activeID, select: setActiveID, created, opened, languageStatus, dispose }
}

function fileTab(id: string, path: string): OpenTab {
  return {
    id,
    input: path,
    title: path,
    kind: "file",
    path,
    directory: "C:/repo",
    content: { type: "text", content: "const value = 1" },
    fileMode: "editable",
    text: "const value = 1",
    original: "const value = 1",
  }
}

function definitionFetch(locations: unknown[]) {
  return (async () => new Response(JSON.stringify(locations), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch
}
