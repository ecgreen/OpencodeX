import type { TuiTheme } from "@opencode-ai/plugin/tui"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { ConfigPlugin } from "@/config/plugin"
import { PluginMeta } from "@/plugin/meta"
import { readPackageThemes, type PluginPackage } from "@/plugin/shared"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { hasTheme, upsertTheme } from "../context/theme"
import { pluginLog, warn } from "./runtime-diagnostics"
import type { PluginEntry } from "./runtime-types"

function isTheme(value: unknown) {
  if (!isRecord(value)) return false
  if (!("theme" in value)) return false
  return isRecord(value.theme)
}

export function createThemeInstaller(
  meta: ConfigPlugin.Origin,
  root: string,
  spec: string,
  plugin: PluginEntry,
): TuiTheme["install"] {
  return async (file) => {
    const src = Filesystem.resolveFilePath(root, file)
    const name = path.basename(src, path.extname(src))
    const source_dir = path.dirname(meta.source)
    const local_dir =
      path.basename(source_dir) === ".opencode"
        ? path.join(source_dir, "themes")
        : path.join(source_dir, ".opencode", "themes")
    const dest_dir = meta.scope === "local" ? local_dir : path.join(Global.Path.config, "themes")
    const dest = path.join(dest_dir, `${name}.json`)
    const stat = await Filesystem.statAsync(src)
    const mtime = stat ? Math.floor(typeof stat.mtimeMs === "bigint" ? Number(stat.mtimeMs) : stat.mtimeMs) : undefined
    const size = stat ? (typeof stat.size === "bigint" ? Number(stat.size) : stat.size) : undefined
    const info = { src, dest, mtime, size }

    await Flock.withLock(`tui-theme:${dest}`, async () => {
      const save = async () => {
        plugin.themes[name] = info
        await PluginMeta.setTheme(plugin.id, name, info).catch((error) => {
          pluginLog.warn("failed to track tui plugin theme", {
            path: spec,
            id: plugin.id,
            theme: src,
            dest,
            error,
          })
        })
      }

      const exists = hasTheme(name)
      const prev = plugin.themes[name]
      if (exists) {
        if (plugin.meta.state !== "updated") {
          if (!prev && (await Filesystem.exists(dest))) await save()
          return
        }
        if (prev?.dest === dest && prev.mtime === mtime && prev.size === size) return
      }

      const text = await Filesystem.readText(src).catch((error) => {
        pluginLog.warn("failed to read tui plugin theme", { path: spec, theme: src, error })
        return
      })
      if (text === undefined) return

      const failed = Symbol()
      const data = await Promise.resolve(text)
        .then((value) => JSON.parse(value))
        .catch((error) => {
          pluginLog.warn("failed to parse tui plugin theme", { path: spec, theme: src, error })
          return failed
        })
      if (data === failed) return
      if (!isTheme(data)) {
        pluginLog.warn("invalid tui plugin theme", { path: spec, theme: src })
        return
      }

      if (exists || !(await Filesystem.exists(dest))) {
        await Filesystem.write(dest, text).catch((error) => {
          pluginLog.warn("failed to persist tui plugin theme", { path: spec, theme: src, dest, error })
        })
      }

      upsertTheme(name, data)
      await save()
    }).catch((error) => {
      pluginLog.warn("failed to lock tui plugin theme install", { path: spec, theme: src, dest, error })
    })
  }
}

export async function readThemeFiles(spec: string, pkg?: PluginPackage) {
  if (!pkg) return [] as string[]
  return Promise.resolve()
    .then(() => readPackageThemes(spec, pkg))
    .catch((error) => {
      warn("invalid tui plugin oc-themes", { path: spec, pkg: pkg.pkg, error })
      return [] as string[]
    })
}

export async function syncPluginThemes(plugin: PluginEntry) {
  if (!plugin.load.theme_files.length) return
  if (plugin.meta.state === "same") return
  const install = createThemeInstaller(plugin.load.origin, plugin.load.plugin_root, plugin.load.spec, plugin)
  for (const file of plugin.load.theme_files) {
    await install(file).catch((error) => {
      warn("failed to sync tui plugin oc-themes", { path: plugin.load.spec, id: plugin.id, theme: file, error })
    })
  }
}
