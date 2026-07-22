import { runtimeModules } from "@opentui/keymap/runtime-modules"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { Effect } from "effect"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Flag } from "@opencode-ai/core/flag/flag"
import { setupSlots, Slot as View } from "./slots"
import { fail, pluginLog } from "./runtime-diagnostics"
import { addPluginBySpec, installPluginBySpec } from "./runtime-install"
import { addExternalPluginEntries, addInternalPluginEntries, resolveExternalPlugins } from "./runtime-loader"
import {
  activatePluginById,
  activatePluginEntry,
  applyInitialPluginEnabledState,
  deactivatePluginById,
  deactivatePluginEntry,
  listPluginStatus,
} from "./runtime-state"
import type { HostPluginApi } from "./slots"
import type { RuntimeState } from "./runtime-types"

ensureRuntimePluginSupport({ additional: runtimeModules })

const DISPOSE_TIMEOUT_MS = 5000
const actions = {
  list: listPluginStatus,
  activate: activatePluginById,
  deactivate: deactivatePluginById,
  add: addPluginBySpec,
  install: installPluginBySpec,
}

let dir = ""
let loaded: Promise<void> | undefined
let runtime: RuntimeState | undefined

export const Slot = View

export async function init(input: {
  api: HostPluginApi
  config: TuiConfig.Resolved
  dispose?: () => void
  disposeTimeoutMs?: number
  install?: RuntimeState["install"]
  toggle?: RuntimeState["toggle"]
}) {
  const cwd = process.cwd()
  if (loaded) {
    if (dir !== cwd) {
      throw new Error(`TuiPluginRuntime.init() called with a different working directory. expected=${dir} got=${cwd}`)
    }
    return loaded
  }

  dir = cwd
  loaded = load(input)
  return loaded
}

export function list() {
  if (!runtime) return []
  return listPluginStatus(runtime)
}

export async function activatePlugin(id: string) {
  return activatePluginById(runtime, id, true)
}

export async function deactivatePlugin(id: string) {
  return deactivatePluginById(runtime, id, true)
}

export async function addPlugin(spec: string) {
  return addPluginBySpec(runtime, spec)
}

export async function installPlugin(spec: string, options?: { global?: boolean }) {
  return installPluginBySpec(runtime, spec, options?.global)
}

export async function dispose() {
  const task = loaded
  loaded = undefined
  dir = ""
  if (task) await task
  const state = runtime
  runtime = undefined
  if (!state) return
  for (const plugin of [...state.plugins].reverse()) {
    await deactivatePluginEntry(state, plugin, false)
  }
  state.dispose?.()
}

async function load(input: {
  api: HostPluginApi
  config: TuiConfig.Resolved
  dispose?: () => void
  disposeTimeoutMs?: number
  install?: RuntimeState["install"]
  toggle?: RuntimeState["toggle"]
}) {
  const cwd = process.cwd()
  const next: RuntimeState = {
    directory: cwd,
    api: input.api,
    dispose: input.dispose,
    slots: setupSlots(input.api),
    plugins: [],
    plugins_by_id: new Map(),
    pending: new Map(),
    install: input.install,
    toggle: input.toggle,
    dispose_timeout_ms: input.disposeTimeoutMs ?? DISPOSE_TIMEOUT_MS,
    actions,
  }
  runtime = next

  try {
    const flags = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* RuntimeFlags.Service
      }).pipe(Effect.provide(RuntimeFlags.defaultLayer)),
    )
    const records = Flag.OPENCODE_PURE ? [] : (input.config.plugin_origins ?? [])
    if (Flag.OPENCODE_PURE && input.config.plugin_origins?.length) {
      pluginLog.info("skipping external tui plugins in pure mode", { count: input.config.plugin_origins.length })
    }

    addInternalPluginEntries(next, flags)
    await addExternalPluginEntries(next, await resolveExternalPlugins(records, () => TuiConfig.waitForDependencies()))
    applyInitialPluginEnabledState(next, input.config)

    for (const plugin of next.plugins) {
      if (!plugin.enabled) continue
      // Registration order controls command precedence, route collision behavior, and hook chains.
      await activatePluginEntry(next, plugin, false)
    }
  } catch (error) {
    fail("failed to load tui plugins", { directory: cwd, error })
  }
}

export * as TuiPluginRuntime from "./runtime"
