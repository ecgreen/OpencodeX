import type { TuiPluginMeta, TuiPluginModule } from "@opencode-ai/plugin/tui"
import path from "path"
import { fileURLToPath } from "url"
import { ConfigPlugin } from "@/config/plugin"
import { PluginLoader } from "@/plugin/loader"
import { PluginMeta } from "@/plugin/meta"
import { readPluginId, readV1Plugin, resolvePluginId } from "@/plugin/shared"
import { internalTuiPlugins, type InternalTuiPlugin } from "./internal"
import { fail, pluginLog, warn } from "./runtime-diagnostics"
import { addPluginEntry } from "./runtime-state"
import { readThemeFiles } from "./runtime-theme"
import type { PluginEntry, PluginLoad, RuntimeState } from "./runtime-types"

const EMPTY_TUI: TuiPluginModule = {
  tui: async () => {},
}

function resolveRoot(root: string) {
  if (root.startsWith("file://")) {
    const file = fileURLToPath(root)
    if (root.endsWith("/")) return file
    return path.dirname(file)
  }
  if (path.isAbsolute(root)) return root
  return path.resolve(process.cwd(), root)
}

function createMeta(
  source: PluginLoad["source"],
  spec: string,
  target: string,
  meta: { state: PluginMeta.State; entry: PluginMeta.Entry } | undefined,
  id?: string,
): TuiPluginMeta {
  if (meta) {
    return {
      state: meta.state,
      ...meta.entry,
    }
  }

  const now = Date.now()
  return {
    state: source === "internal" ? "same" : "first",
    id: id ?? spec,
    source,
    spec,
    target,
    first_time: now,
    last_time: now,
    time_changed: now,
    load_count: 1,
    fingerprint: target,
  }
}

function loadInternalPlugin(item: InternalTuiPlugin): PluginLoad {
  return {
    options: undefined,
    spec: item.id,
    target: item.id,
    retry: false,
    source: "internal",
    id: item.id,
    module: item,
    origin: {
      spec: item.id,
      scope: "global",
      source: item.id,
    },
    plugin_root: process.cwd(),
    theme_files: [],
  }
}

export function addInternalPluginEntries(state: RuntimeState, flags: Parameters<typeof internalTuiPlugins>[0]) {
  internalTuiPlugins(flags).forEach((item) => {
    pluginLog.info("loading internal tui plugin", { id: item.id })
    const entry = loadInternalPlugin(item)
    addPluginEntry(state, {
      id: entry.id,
      load: entry,
      meta: createMeta(entry.source, entry.spec, entry.target, undefined, entry.id),
      themes: {},
      plugin: entry.module.tui,
      enabled: item.enabled ?? true,
    })
  })
}

export async function resolveExternalPlugins(list: ConfigPlugin.Origin[], wait: () => Promise<void>) {
  return PluginLoader.loadExternal({
    items: list,
    kind: "tui",
    wait: async () => {
      await wait().catch((error) => {
        pluginLog.warn("failed waiting for tui plugin dependencies", { error })
      })
    },
    finish: async (loaded, origin, retry) => {
      const mod = await Promise.resolve()
        .then(() => readV1Plugin(loaded.mod as Record<string, unknown>, loaded.spec, "tui") as TuiPluginModule)
        .catch((error) => {
          fail("failed to load tui plugin", { path: loaded.spec, target: loaded.entry, retry, error })
          return
        })
      if (!mod) return

      const id = await resolvePluginId(
        loaded.source,
        loaded.spec,
        loaded.target,
        readPluginId(mod.id, loaded.spec),
        loaded.pkg,
      ).catch((error) => {
        fail("failed to load tui plugin", { path: loaded.spec, target: loaded.target, retry, error })
        return
      })
      if (!id) return

      return {
        options: loaded.options,
        spec: loaded.spec,
        target: loaded.target,
        retry,
        source: loaded.source,
        id,
        module: mod,
        origin,
        plugin_root: loaded.pkg?.dir ?? resolveRoot(loaded.target),
        theme_files: await readThemeFiles(loaded.spec, loaded.pkg),
      }
    },
    missing: async (loaded, origin, retry) => {
      const theme_files = await readThemeFiles(loaded.spec, loaded.pkg)
      if (!theme_files.length) return

      const name =
        typeof loaded.pkg?.json.name === "string" && loaded.pkg.json.name.trim().length > 0
          ? loaded.pkg.json.name.trim()
          : undefined
      const id = await resolvePluginId(loaded.source, loaded.spec, loaded.target, name, loaded.pkg).catch((error) => {
        fail("failed to load tui plugin", { path: loaded.spec, target: loaded.target, retry, error })
        return
      })
      if (!id) return

      return {
        options: loaded.options,
        spec: loaded.spec,
        target: loaded.target,
        retry,
        source: loaded.source,
        id,
        module: EMPTY_TUI,
        origin,
        plugin_root: loaded.pkg?.dir ?? resolveRoot(loaded.target),
        theme_files,
      }
    },
    report: {
      start(candidate, retry) {
        pluginLog.info("loading tui plugin", { path: candidate.plan.spec, retry })
      },
      missing(candidate, retry, message) {
        warn("tui plugin has no entrypoint", { path: candidate.plan.spec, retry, message })
      },
      error(candidate, retry, stage, error, resolved) {
        const spec = candidate.plan.spec
        if (stage === "install") {
          fail("failed to resolve tui plugin", { path: spec, retry, error })
          return
        }
        if (stage === "compatibility") {
          fail("tui plugin incompatible", { path: spec, retry, error })
          return
        }
        if (stage === "entry") {
          fail("failed to resolve tui plugin entry", { path: spec, retry, error })
          return
        }
        fail("failed to load tui plugin", { path: spec, target: resolved?.entry, retry, error })
      },
    },
  })
}

export async function addExternalPluginEntries(state: RuntimeState, ready: PluginLoad[]) {
  if (!ready.length) return { plugins: [] as PluginEntry[], ok: true }

  const meta = await PluginMeta.touchMany(
    ready.map((item) => ({ spec: item.spec, target: item.target, id: item.id })),
  ).catch((error) => {
    pluginLog.warn("failed to track tui plugins", { error })
    return undefined
  })

  const plugins: PluginEntry[] = []
  let ok = true
  ready.forEach((entry, index) => {
    const hit = meta?.[index]
    if (hit && hit.state !== "same") {
      pluginLog.info("tui plugin metadata updated", {
        path: entry.spec,
        retry: entry.retry,
        state: hit.state,
        source: hit.entry.source,
        version: hit.entry.version,
        modified: hit.entry.modified,
      })
    }

    const plugin: PluginEntry = {
      id: entry.id,
      load: entry,
      meta: createMeta(entry.source, entry.spec, entry.target, hit, entry.id),
      themes: hit?.entry.themes ? { ...hit.entry.themes } : {},
      plugin: entry.module.tui,
      enabled: true,
    }
    if (!addPluginEntry(state, plugin)) {
      ok = false
      return
    }
    plugins.push(plugin)
  })

  return { plugins, ok }
}
