import type { TuiPluginStatus } from "@opencode-ai/plugin/tui"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { createPluginApi } from "./runtime-api"
import { fail } from "./runtime-diagnostics"
import { createPluginScope } from "./runtime-scope"
import { syncPluginThemes } from "./runtime-theme"
import type { PluginEntry, RuntimeState } from "./runtime-types"

function persistPluginEnabledState(state: RuntimeState, plugin: PluginEntry, enabled: boolean) {
  if (!state.toggle) return Promise.resolve(true)
  return state.toggle(
    {
      id: plugin.id,
      source: plugin.load.origin.source,
      internal: plugin.load.source === "internal",
    },
    enabled,
  )
}

export function listPluginStatus(state: RuntimeState): TuiPluginStatus[] {
  return state.plugins.map((plugin) => ({
    id: plugin.id,
    source: plugin.meta.source,
    spec: plugin.meta.spec,
    target: plugin.meta.target,
    enabled: plugin.enabled,
    active: plugin.scope !== undefined,
  }))
}

export async function deactivatePluginEntry(state: RuntimeState, plugin: PluginEntry, persist: boolean) {
  if (persist && !(await persistPluginEnabledState(state, plugin, false))) return false
  plugin.enabled = false
  if (!plugin.scope) return true
  const scope = plugin.scope
  plugin.scope = undefined
  await scope.dispose()
  return true
}

export async function activatePluginEntry(state: RuntimeState, plugin: PluginEntry, persist: boolean) {
  if (persist && !(await persistPluginEnabledState(state, plugin, true))) return false
  plugin.enabled = true
  if (plugin.scope) return true

  const scope = createPluginScope(plugin.load, plugin.id, state.dispose_timeout_ms)
  const ok = await Promise.resolve()
    .then(async () => {
      await syncPluginThemes(plugin)
      await plugin.plugin(createPluginApi(state, plugin, scope, plugin.id), plugin.load.options, plugin.meta)
      return true
    })
    .catch((error) => {
      fail("failed to initialize tui plugin", { path: plugin.load.spec, id: plugin.id, error })
      return false
    })

  if (!ok) {
    plugin.enabled = false
    if (persist) await persistPluginEnabledState(state, plugin, false)
    await scope.dispose()
    return false
  }
  if (!plugin.enabled) {
    await scope.dispose()
    return true
  }

  plugin.scope = scope
  return true
}

export async function activatePluginById(state: RuntimeState | undefined, id: string, persist: boolean) {
  if (!state) return false
  const plugin = state.plugins_by_id.get(id)
  if (!plugin) return false
  return activatePluginEntry(state, plugin, persist)
}

export async function deactivatePluginById(state: RuntimeState | undefined, id: string, persist: boolean) {
  if (!state) return false
  const plugin = state.plugins_by_id.get(id)
  if (!plugin) return false
  return deactivatePluginEntry(state, plugin, persist)
}

export function addPluginEntry(state: RuntimeState, plugin: PluginEntry) {
  if (state.plugins_by_id.has(plugin.id)) {
    fail("duplicate tui plugin id", { id: plugin.id, path: plugin.load.spec })
    return false
  }
  state.plugins_by_id.set(plugin.id, plugin)
  state.plugins.push(plugin)
  return true
}

export function applyInitialPluginEnabledState(state: RuntimeState, config: TuiConfig.Resolved) {
  const map = config.plugin_enabled ?? {}
  state.plugins.forEach((plugin) => {
    const enabled = map[plugin.id]
    if (enabled !== undefined) plugin.enabled = enabled
  })
}
