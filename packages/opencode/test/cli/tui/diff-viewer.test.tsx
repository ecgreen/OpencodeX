/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import diffViewerPlugin from "../../../src/cli/cmd/tui/feature-plugins/system/diff-viewer"
import { createTuiPluginApi } from "../../fixture/tui-plugin"

test("closing the diff viewer returns to the route it opened from", async () => {
  const startRoute: TuiRouteCurrent = { name: "session", params: { sessionID: "session-1" } }
  const commands = new Map<
    string,
    NonNullable<Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]["commands"]>[number]
  >()
  let current = startRoute

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const registerLayer = keymap.registerLayer.bind(keymap)
    keymap.registerLayer = (layer) => {
      layer.commands?.forEach((command) => commands.set(command.name, command))
      return registerLayer(layer)
    }
    const base = createTuiPluginApi({
      keymap,
      client: {
        vcs: { diff: async () => ({ data: [] }) },
        session: { diff: async () => ({ data: [] }) },
      } as unknown as TuiPluginApi["client"],
    })
    const api = {
      ...base,
      route: {
        register(routes) {
          void routes
          return () => {}
        },
        navigate(name, params) {
          current = params ? { name, params } : { name }
        },
        get current() {
          return current
        },
      },
    } satisfies TuiPluginApi

    void diffViewerPlugin.tui(api, undefined, pluginMeta)
    commands.get("diff.open")?.run?.({} as never)

    return <box />
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20 })
  try {
    await app.renderOnce()
    expect(current).toEqual({ name: "diff", params: { mode: "git", sessionID: "session-1", returnRoute: startRoute } })

    expect(commands.has("diff.close")).toBe(true)
    commands.get("diff.close")!.run?.({} as never)
    expect(current).toEqual(startRoute)
  } finally {
    app.renderer.destroy()
  }
})

const pluginMeta = {
  id: "diff-viewer",
  source: "internal",
  spec: "diff-viewer",
  target: "diff-viewer",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta
