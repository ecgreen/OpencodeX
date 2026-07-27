import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"
import { Filesystem } from "../../../src/util/filesystem"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("routes plugin installation through the backend authority", async () => {
  await using tmp = await tmpdir()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const calls: Array<{ spec: string; global: boolean }> = []

  try {
    await TuiPluginRuntime.init({
      api: createTuiPluginApi(),
      config: createTuiResolvedConfig(),
      install: async (spec, global) => {
        calls.push({ spec, global })
        return {
          ok: true,
          spec: "acme@1.0.0",
          dir: path.join(tmp.path, ".opencode"),
          tui: false,
          server: true,
          items: [{ kind: "server", mode: "add", file: path.join(tmp.path, ".opencode", "opencode.jsonc") }],
        }
      },
    })

    await expect(TuiPluginRuntime.installPlugin("acme", { global: true })).resolves.toEqual({
      ok: true,
      dir: path.join(tmp.path, ".opencode"),
      tui: false,
    })
    expect(calls).toEqual([{ spec: "acme", global: true }])
    expect(await Filesystem.exists(path.join(tmp.path, ".opencode", "opencode.jsonc"))).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
  }
})

test("toggles plugin runtime state by exported id", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "toggle-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "toggle.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.toggle",
  tui: async (api, options) => {
    const text = await Bun.file(options.marker).text().catch(() => "")
    await Bun.write(options.marker, text + "start\\n")
    api.lifecycle.onDispose(async () => {
      const next = await Bun.file(options.marker).text().catch(() => "")
      await Bun.write(options.marker, next + "stop\\n")
    })
  },
}
`,
      )

      return {
        spec,
        marker,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config = createTuiResolvedConfig({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_enabled: {
      "demo.toggle": false,
    },
    plugin_origins: [
      {
        spec: [tmp.extra.spec, { marker: tmp.extra.marker }],
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi()
  const toggles: Array<{ id: string; source: string; internal: boolean; enabled: boolean }> = []

  try {
    await TuiPluginRuntime.init({
      api,
      config,
      toggle: async (plugin, enabled) => {
        toggles.push({ ...plugin, enabled })
        return true
      },
    })

    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.toggle")).toEqual({
      id: "demo.toggle",
      source: "file",
      spec: tmp.extra.spec,
      target: tmp.extra.spec,
      enabled: false,
      active: false,
    })

    await expect(TuiPluginRuntime.activatePlugin("demo.toggle")).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("start\n")
    expect(toggles).toEqual([
      { id: "demo.toggle", source: path.join(tmp.path, "tui.json"), internal: false, enabled: true },
    ])

    await expect(TuiPluginRuntime.deactivatePlugin("demo.toggle")).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("start\nstop\n")
    expect(toggles.at(-1)).toEqual({
      id: "demo.toggle",
      source: path.join(tmp.path, "tui.json"),
      internal: false,
      enabled: false,
    })

    await expect(TuiPluginRuntime.activatePlugin("missing.id")).resolves.toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("deactivating plugin pops pushed mode", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "mode-plugin.ts")
      const spec = pathToFileURL(file).href

      await Bun.write(
        file,
        `export default {
  id: "demo.mode",
  tui: async (api) => {
    api.mode.push("demo.mode")
  },
}
`,
      )

      return { spec }
    },
  })

  const stack: { id: symbol; mode: string }[] = []
  let popCount = 0
  const api = createTuiPluginApi({
    mode: {
      current: () => stack.at(-1)?.mode ?? "base",
      push(mode) {
        const id = Symbol(mode)
        let active = true
        stack.push({ id, mode })
        return () => {
          if (!active) return
          active = false
          popCount += 1
          const index = stack.findIndex((item) => item.id === id)
          if (index !== -1) stack.splice(index, 1)
        }
      },
    },
  })
  const config = createTuiResolvedConfig({
    plugin: [tmp.extra.spec],
    plugin_origins: [{ spec: tmp.extra.spec, scope: "local", source: path.join(tmp.path, "tui.json") }],
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init({ api, config })

    expect(api.mode.current()).toBe("demo.mode")
    expect(popCount).toBe(0)

    await expect(TuiPluginRuntime.deactivatePlugin("demo.mode")).resolves.toBe(true)

    expect(api.mode.current()).toBe("base")
    expect(popCount).toBe(1)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
  }
})

test("backend config plugin_enabled overrides stale device KV on startup", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "startup-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "startup.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.startup",
  tui: async (_api, options) => {
    await Bun.write(options.marker, "on")
  },
}
`,
      )

      return {
        spec,
        marker,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config = createTuiResolvedConfig({
    plugin: [[tmp.extra.spec, { marker: tmp.extra.marker }]],
    plugin_enabled: {
      "demo.startup": false,
    },
    plugin_origins: [
      {
        spec: [tmp.extra.spec, { marker: tmp.extra.marker }],
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi()
  api.kv.set("plugin_enabled", {
    "demo.startup": true,
  })

  try {
    await TuiPluginRuntime.init({ api, config })

    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.startup")).toEqual({
      id: "demo.startup",
      source: "file",
      spec: tmp.extra.spec,
      target: tmp.extra.spec,
      enabled: false,
      active: false,
    })
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("loads disabled-by-default internal plugin inactive and activates on demand", async () => {
  await using tmp = await tmpdir()
  const config = createTuiResolvedConfig()
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi()
  const toggles: Array<{ id: string; source: string; internal: boolean; enabled: boolean }> = []

  try {
    await TuiPluginRuntime.init({
      api,
      config,
      toggle: async (plugin, enabled) => {
        toggles.push({ ...plugin, enabled })
        return true
      },
    })

    expect(TuiPluginRuntime.list().find((item) => item.id === "internal:plugin-manager")).toMatchObject({
      enabled: true,
      active: true,
    })
    expect(TuiPluginRuntime.list().find((item) => item.id === "which-key")).toEqual({
      id: "which-key",
      source: "internal",
      spec: "which-key",
      target: "which-key",
      enabled: false,
      active: false,
    })

    await expect(TuiPluginRuntime.activatePlugin("which-key")).resolves.toBe(true)
    expect(TuiPluginRuntime.list().find((item) => item.id === "which-key")).toEqual({
      id: "which-key",
      source: "internal",
      spec: "which-key",
      target: "which-key",
      enabled: true,
      active: true,
    })
    expect(toggles).toEqual([{ id: "which-key", source: "which-key", internal: true, enabled: true }])
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
  }
})
