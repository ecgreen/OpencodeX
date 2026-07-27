import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { resolveAttentionSoundPaths } from "../config/tui-schema"
import { createCommandShim } from "./command-shim"
import { createThemeInstaller } from "./runtime-theme"
import type { PluginEntry, PluginScope, RuntimeState } from "./runtime-types"

const ScopedKeymapMethods = new Set<PropertyKey>([
  "acquireResource",
  "registerLayer",
  "registerLayerFields",
  "prependLayerBindingsTransformer",
  "appendLayerBindingsTransformer",
  "prependBindingTransformer",
  "appendBindingTransformer",
  "prependBindingParser",
  "appendBindingParser",
  "registerToken",
  "registerSequencePattern",
  "prependBindingExpander",
  "appendBindingExpander",
  "registerBindingFields",
  "registerCommandFields",
  "prependCommandTransformer",
  "appendCommandTransformer",
  "prependCommandResolver",
  "appendCommandResolver",
  "prependLayerAnalyzer",
  "appendLayerAnalyzer",
  "intercept",
  "on",
  "prependEventMatchResolver",
  "appendEventMatchResolver",
  "prependDisambiguationResolver",
  "appendDisambiguationResolver",
])

function createScopedKeymap(keymap: TuiPluginApi["keymap"], scope: PluginScope): TuiPluginApi["keymap"] {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(keymap, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== "function") return value
      if (cache.has(prop)) return cache.get(prop)
      const fn = ScopedKeymapMethods.has(prop)
        ? (...args: unknown[]) => {
            const dispose = (value as (...args: unknown[]) => unknown).apply(target, args)
            return scope.track(typeof dispose === "function" ? (dispose as () => void) : undefined)
          }
        : (...args: unknown[]) => (value as (...args: unknown[]) => unknown).apply(target, args)
      cache.set(prop, fn)
      return fn
    },
  })
}

function createScopedAttention(
  attention: TuiPluginApi["attention"],
  scope: PluginScope,
  root: string,
): TuiPluginApi["attention"] {
  return {
    notify(input) {
      return attention.notify(input)
    },
    soundboard: {
      registerPack(pack) {
        return scope.track(
          attention.soundboard.registerPack({
            ...pack,
            sounds: resolveAttentionSoundPaths(root, pack.sounds, { trim: true }),
          }),
        )
      },
      activate(id, options) {
        return attention.soundboard.activate(id, options)
      },
      current() {
        return attention.soundboard.current()
      },
      list() {
        return attention.soundboard.list()
      },
    },
  }
}

function createScopedMode(mode: TuiPluginApi["mode"], scope: PluginScope): TuiPluginApi["mode"] {
  return {
    current() {
      return mode.current()
    },
    push(value) {
      return scope.track(mode.push(value))
    },
  }
}

export function createPluginApi(
  runtime: RuntimeState,
  plugin: PluginEntry,
  scope: PluginScope,
  base: string,
): TuiPluginApi {
  const api = runtime.api
  const keymap = createScopedKeymap(api.keymap, scope)
  let count = 0

  const slots: TuiPluginApi["slots"] = {
    register(value: TuiSlotPlugin) {
      const id = count ? `${base}:${count}` : base
      count += 1
      scope.track(runtime.slots.register({ ...value, id }))
      return id
    },
  }

  return {
    app: api.app,
    attention: createScopedAttention(api.attention, scope, plugin.load.plugin_root),
    // Keep deprecated `api.command` working for v1 plugins; remove in v2.
    command: createCommandShim(keymap, api.ui.dialog, api.tuiConfig.keybinds),
    keys: api.keys,
    keymap,
    mode: createScopedMode(api.mode, scope),
    route: {
      register(list) {
        return scope.track(api.route.register(list))
      },
      navigate(name, params) {
        api.route.navigate(name, params)
      },
      get current() {
        return api.route.current
      },
    },
    ui: api.ui,
    tuiConfig: api.tuiConfig,
    kv: api.kv,
    state: api.state,
    theme: Object.assign(Object.create(api.theme), {
      install: createThemeInstaller(plugin.load.origin, plugin.load.plugin_root, plugin.load.spec, plugin),
    }),
    get client() {
      return api.client
    },
    event: {
      on(type, handler) {
        return scope.track(api.event.on(type, handler))
      },
    },
    renderer: api.renderer,
    slots,
    plugins: {
      list() {
        return runtime.actions.list(runtime)
      },
      activate(id) {
        return runtime.actions.activate(runtime, id, true)
      },
      deactivate(id) {
        return runtime.actions.deactivate(runtime, id, true)
      },
      add(spec) {
        return runtime.actions.add(runtime, spec)
      },
      install(spec, options) {
        return runtime.actions.install(runtime, spec, options?.global)
      },
    },
    lifecycle: scope.lifecycle,
  }
}
