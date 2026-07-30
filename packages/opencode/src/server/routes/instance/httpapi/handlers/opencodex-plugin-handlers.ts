import { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { directories, fileInDirectory, files } from "@/config/paths"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXPlugin } from "@/opencodex/plugin"
import { installPlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { internalTuiPluginManifest } from "@/plugin/internal-tui-manifest"
import { PluginLoader } from "@/plugin/loader"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { readPluginId, readV1Plugin, resolvePluginId } from "@/plugin/shared"
import { errorMessage } from "@/util/error"
import { Filesystem } from "@/util/filesystem"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { PluginListQuery } from "../groups/opencodex"
import { markInstanceForDisposal } from "../lifecycle"
import path from "path"

export const makeOpencodeXPluginHandlers = Effect.fn("OpencodeXHttpApi.makePluginHandlers")(function* () {
  const config = yield* Config.Service
  const fs = yield* AppFileSystem.Service
  const runtimeFlags = yield* RuntimeFlags.Service
  const events = yield* EventV2Bridge.Service
  const flock = yield* EffectFlock.Service
  const bridge = yield* EffectBridge.make()

  const snapshot = Effect.fn("OpencodeXHttpApi.pluginSnapshot")(function* () {
    const instance = yield* InstanceState.context
    return dedupePlugins([
      ...(yield* internalTuiPluginRows(fs)),
      ...serverPlugins(yield* config.get()),
      ...(yield* readTuiPlugins(instance.directory, fs)),
    ])
  })

  const listPlugins = Effect.fn("OpencodeXHttpApi.listPlugins")(function* (_ctx: {
    query: typeof PluginListQuery.Type
  }) {
    return yield* snapshot()
  })

  const installPluginHandler = Effect.fn("OpencodeXHttpApi.installPlugin")(function* (ctx: {
    query: typeof PluginListQuery.Type
    payload: OpencodeXPlugin.InstallInput
  }) {
    const spec = ctx.payload.spec.trim()
    if (!spec) return yield* Effect.fail(new HttpApiError.BadRequest({}))
    const instance = yield* InstanceState.context
    const installed = yield* Effect.promise(() => installPlugin(spec, undefined, instance.directory))
    if (!installed.ok) {
      return {
        ok: false,
        message: errorMessage(installed.error) || `Failed to install ${spec}`,
        tui: false,
        server: false,
        items: [],
      }
    }
    const manifest = yield* Effect.promise(() => readPluginManifest(installed.target))
    if (!manifest.ok) {
      return {
        ok: false,
        message:
          manifest.code === "manifest_no_targets"
            ? `"${spec}" does not expose plugin entrypoints or oc-themes in package.json`
            : `Installed "${spec}" but failed to read ${manifest.file}`,
        tui: false,
        server: false,
        items: [],
      }
    }
    const patch = yield* Effect.promise(() =>
      patchPluginConfig({
        spec: installed.spec,
        targets: manifest.targets,
        force: ctx.payload.force,
        global: ctx.payload.global,
        vcs: instance.worktree && instance.worktree !== "/" ? "git" : undefined,
        worktree: instance.worktree,
        directory: instance.directory,
      }),
    )
    if (!patch.ok) {
      return {
        ok: false,
        message:
          patch.code === "invalid_json"
            ? `Invalid JSON in ${patch.file} (${patch.parse} at line ${patch.line}, column ${patch.col})`
            : errorMessage(patch.error),
        tui: false,
        server: false,
        items: [],
      }
    }
    yield* config.invalidate()
    yield* events.publish(OpencodeXPlugin.Event.Updated, {
      global: Boolean(ctx.payload.global),
      spec: installed.spec,
    })
    if (patch.items.some((item) => item.kind === "server" && item.mode !== "noop")) {
      if (ctx.payload.global) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      if (!ctx.payload.global) yield* markInstanceForDisposal(instance)
    }
    return {
      ok: true,
      spec: installed.spec,
      dir: patch.dir,
      tui: manifest.targets.some((item) => item.kind === "tui"),
      server: manifest.targets.some((item) => item.kind === "server"),
      items: patch.items,
    }
  })

  const togglePlugin = Effect.fn("OpencodeXHttpApi.togglePlugin")(function* (ctx: {
    query: typeof PluginListQuery.Type
    payload: OpencodeXPlugin.ToggleInput
  }) {
    const item = (yield* snapshot()).find((plugin) => plugin.id === ctx.payload.id)
    if (!item || !item.canToggle || item.kind !== "tui") return yield* Effect.fail(new HttpApiError.BadRequest({}))
    if (!(yield* patchTuiPluginEnabled(flock, item.source, item.pluginID, ctx.payload.enabled))) {
      return yield* Effect.fail(new HttpApiError.BadRequest({}))
    }
    yield* events.publish(OpencodeXPlugin.Event.Updated, {
      global: item.scope !== "local",
      spec: item.spec,
    })
    const next = (yield* snapshot()).find((plugin) => plugin.id === ctx.payload.id)
    if (!next) return yield* Effect.fail(new HttpApiError.BadRequest({}))
    return next
  })

  return { snapshot, listPlugins, installPluginHandler, togglePlugin }
})

export type OpencodeXPluginHandlers = Effect.Success<ReturnType<typeof makeOpencodeXPluginHandlers>>

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function pluginSpecifier(input: unknown) {
  if (typeof input === "string") return input
  if (!Array.isArray(input) || typeof input[0] !== "string") return
  return input[0]
}

function normalizeTuiConfig(input: unknown) {
  if (!isRecord(input)) return {}
  if (!isRecord(input.tui)) return input
  return { ...input.tui, ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== "tui")) }
}

function enabledMap(input: unknown) {
  if (!isRecord(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((item): item is [string, boolean] => typeof item[1] === "boolean"),
  )
}

function pluginRow(input: {
  kind: OpencodeXPlugin.Kind
  pluginID?: string
  spec: string
  source: string
  scope: OpencodeXPlugin.Scope
  enabled: boolean
  active: boolean
  canToggle: boolean
  target?: string
  note?: string
}): OpencodeXPlugin.Info {
  return { id: `${input.kind}:${input.source}:${input.pluginID ?? input.spec}`, pluginID: input.pluginID ?? input.spec, ...input }
}

function dedupePlugins(items: OpencodeXPlugin.Info[]) {
  return [...new Map(items.map((item): [string, OpencodeXPlugin.Info] => [item.id, item])).values()].toSorted(
    (left, right) =>
      (left.kind === "tui" ? 0 : 1) - (right.kind === "tui" ? 0 : 1) ||
      (left.scope === "local" ? 0 : left.scope === "global" ? 1 : 2) -
        (right.scope === "local" ? 0 : right.scope === "global" ? 1 : 2) ||
      left.spec.localeCompare(right.spec),
  )
}

function tuiPluginFiles(directory: string) {
  return Effect.gen(function* () {
    const projectFiles = yield* files("tui", directory).pipe(Effect.orDie)
    const configDirectories = yield* directories(directory).pipe(Effect.orDie)
    return [
      ...new Set([
        ...fileInDirectory(Global.Path.config, "tui"),
        ...projectFiles,
        ...configDirectories.flatMap((configDirectory) => fileInDirectory(configDirectory, "tui")),
      ]),
    ]
  })
}

function readTuiEnabledMap(file: string, fs: AppFileSystem.Interface) {
  return fs.readFileStringSafe(file).pipe(
    Effect.orDie,
    Effect.map((text) => {
      if (!text) return {}
      return enabledMap(normalizeTuiConfig(parse(text)).plugin_enabled)
    }),
  )
}

function existingTuiConfigFile(configFiles: string[], fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const checks = yield* Effect.forEach(
      configFiles,
      (file) =>
        fs.readFileStringSafe(file).pipe(
          Effect.orDie,
          Effect.map((text) => ({ file, exists: text !== undefined })),
        ),
      { concurrency: "unbounded" },
    )
    return checks.find((item) => item.exists)?.file ?? configFiles[0]
  })
}

async function resolveTuiPluginID(item: ConfigPlugin.Origin) {
  const resolved = await PluginLoader.loadExternal<{ pluginID: string; target: string; source: string }>({
    items: [item],
    kind: "tui",
    finish: async (loaded) => {
      const plugin = readV1Plugin(loaded.mod as Record<string, unknown>, loaded.spec, "tui")
      if (!plugin) return
      return {
        pluginID: await resolvePluginId(
          loaded.source,
          loaded.spec,
          loaded.target,
          readPluginId(plugin.id, loaded.spec),
          loaded.pkg,
        ),
        target: loaded.target,
        source: loaded.source,
      }
    },
  })
  return resolved[0]
}

function readTuiPlugins(directory: string, fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const rows = yield* Effect.forEach(
      yield* tuiPluginFiles(directory),
      (file) =>
        fs.readFileStringSafe(file).pipe(
          Effect.orDie,
          Effect.map((text) => {
            if (!text) return []
            const data = normalizeTuiConfig(parse(text))
            const plugins = Array.isArray(data.plugin) ? data.plugin : []
            return plugins.flatMap((item) => {
              const spec = pluginSpecifier(item)
              if (!spec) return []
              return [{ spec, source: file, scope: Filesystem.contains(directory, file) ? "local" as const : "global" as const }]
            })
          }),
        ),
      { concurrency: "unbounded" },
    )
    return yield* Effect.forEach(
      rows.flat(),
      (item) =>
        Effect.gen(function* () {
          const resolved = yield* Effect.promise(() => resolveTuiPluginID(item)).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const pluginID = resolved?.pluginID ?? item.spec
          const enabled = yield* readTuiEnabledMap(item.source, fs)
          const state = enabled[pluginID] ?? enabled[item.spec] ?? true
          return pluginRow({
            kind: "tui",
            pluginID,
            spec: item.spec,
            source: item.source,
            scope: item.scope,
            enabled: state,
            active: state,
            canToggle: true,
            target: resolved?.target,
            note: resolved
              ? "TUI plugin state applies when the TUI runtime loads this config."
              : "Configured TUI plugin could not be resolved yet; install dependencies or restart the runtime.",
          })
        }),
      { concurrency: "unbounded" },
    )
  })
}

function internalTuiPluginRows(fs: AppFileSystem.Interface) {
  return Effect.gen(function* () {
    const configFile = yield* existingTuiConfigFile(fileInDirectory(Global.Path.config, "tui"), fs)
    const enabled = yield* readTuiEnabledMap(configFile, fs)
    return internalTuiPluginManifest().map((item) => {
      const state = enabled[item.id] ?? item.enabled ?? true
      return pluginRow({
        kind: "tui",
        pluginID: item.id,
        spec: item.id,
        source: configFile,
        scope: "internal",
        enabled: state,
        active: state,
        canToggle: item.id !== "internal:plugin-manager",
        target: item.id,
        note: "Built-in TUI plugin.",
      })
    })
  })
}

function serverPlugins(config: Config.Info) {
  return (config.plugin_origins ?? []).map((item) =>
    pluginRow({
      kind: "server",
      pluginID: ConfigPlugin.pluginSpecifier(item.spec),
      spec: ConfigPlugin.pluginSpecifier(item.spec),
      source: item.source,
      scope: item.scope,
      enabled: true,
      active: true,
      canToggle: false,
      note: "Server plugins are loaded by the backend; live unload is not exposed in the GUI yet.",
    }),
  )
}

/**
 * Shares the `plug-config:<dir>` lock with `plugin/install.ts`, which still
 * uses the promise-based `Flock`. Both sit on the same on-disk protocol
 * (`LockProtocol`), so an Effect holder and a promise holder exclude each
 * other correctly. A lock failure is a defect, matching the old behaviour
 * where `Flock.acquire` rejected into `Effect.promise`.
 */
function patchTuiPluginEnabled(flock: EffectFlock.Interface, file: string, spec: string, enabled: boolean) {
  return flock
    .withLock(
      Effect.promise(async () => {
        const before = await Filesystem.readText(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "{}"
          throw error
        })
        const errors: ParseError[] = []
        const parsed = parse(before, errors, { allowTrailingComma: true })
        if (errors.length > 0 || (parsed !== undefined && !isRecord(parsed))) return false
        const document = before.trim() ? before : "{}"
        const next = applyEdits(
          document,
          modify(document, ["plugin_enabled", spec], enabled, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          }),
        )
        await Filesystem.writeAtomic(file, next)
        return true
      }),
      `plug-config:${Filesystem.resolve(path.dirname(file))}`,
    )
    .pipe(Effect.orDie)
}
