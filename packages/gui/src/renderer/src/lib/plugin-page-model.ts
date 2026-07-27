import type { InstalledGuiPlugin } from "./gui-plugins"
import type { GuiPlugin } from "./store"

export function pluginPageStats(plugins: GuiPlugin[]) {
  return {
    total: plugins.length,
    active: plugins.filter((plugin) => plugin.active).length,
    disabled: plugins.filter((plugin) => !plugin.enabled).length,
    internal: plugins.filter((plugin) => plugin.scope === "internal").length,
  }
}

export function guiPluginPageStats(plugins: InstalledGuiPlugin[]) {
  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    commands: plugins.flatMap((plugin) => plugin.manifest.contributes?.commands ?? []).length,
    themes: plugins.filter((plugin) => plugin.manifest.contributes?.theme).length,
  }
}

export function filterGuiPluginPagePlugins(plugins: InstalledGuiPlugin[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return plugins
  return plugins.filter((plugin) => [
    plugin.manifest.id,
    plugin.manifest.name,
    plugin.manifest.description,
    plugin.manifest.author,
    plugin.source,
    ...plugin.manifest.permissions,
    ...(plugin.manifest.contributes?.commands?.flatMap((command) => [command.id, command.title, command.description]) ?? []),
    ...(plugin.manifest.contributes?.snippets?.flatMap((snippet) => [snippet.id, snippet.title, snippet.description]) ?? []),
  ].some((item) => item?.toLowerCase().includes(needle)))
}

export function filterPluginPagePlugins(plugins: GuiPlugin[], scope: "all" | GuiPlugin["scope"], query: string) {
  const needle = query.trim().toLowerCase()
  return plugins.filter((plugin) => {
    const matchesScope = scope === "all" || plugin.scope === scope
    if (!matchesScope) return false
    if (!needle) return true
    return [plugin.spec, plugin.pluginID, plugin.source, plugin.target, plugin.note]
      .some((item) => item?.toLowerCase().includes(needle))
  })
}

export function pluginPageGroups(plugins: GuiPlugin[]) {
  return [
    { title: "TUI Plugins", items: plugins.filter((plugin) => plugin.kind === "tui") },
    { title: "Server Plugins", items: plugins.filter((plugin) => plugin.kind === "server") },
  ]
}
