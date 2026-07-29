import { createEffect, createSignal, type Accessor, type Setter } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { GuiSnapshot } from "../lib/session-api"
import {
  installGuiPlugin,
  readInstalledGuiPlugins,
  writeInstalledGuiPlugins,
  type GuiPluginManifest,
  type InstalledGuiPlugin,
} from "../lib/gui-plugins"
import { listPlugins } from "../lib/session-api"

export function createPluginController(input: {
  client: Accessor<GuiClient | undefined>
  setSnapshot: Setter<GuiSnapshot | undefined>
}) {
  const [plugins, setPlugins] = createSignal<InstalledGuiPlugin[]>(readInstalledGuiPlugins())

  createEffect(() => writeInstalledGuiPlugins(plugins()))

  async function refresh() {
    const client = input.client()
    if (!client) return
    const plugins = await listPlugins(client)
    input.setSnapshot((current) => (current ? { ...current, plugins } : current))
  }

  function install(manifest: GuiPluginManifest, source: InstalledGuiPlugin["source"]) {
    setPlugins((plugins) => installGuiPlugin(plugins, manifest, source))
  }

  function toggle(id: string) {
    setPlugins((plugins) =>
      plugins.map((plugin) => (plugin.manifest.id === id ? { ...plugin, enabled: !plugin.enabled } : plugin)),
    )
  }

  function remove(id: string) {
    setPlugins((plugins) => plugins.filter((plugin) => plugin.manifest.id !== id))
  }

  return { plugins, refresh, install, toggle, remove }
}
