import type {
  TuiDispose,
  TuiPlugin,
  TuiPluginApi,
  TuiPluginInstallResult,
  TuiPluginMeta,
  TuiPluginModule,
  TuiPluginStatus,
} from "@opencode-ai/plugin/tui"
import type { ConfigPlugin } from "@/config/plugin"
import type { OpencodeXPluginInstallResult } from "@opencode-ai/sdk/v2"
import type { PluginMeta } from "@/plugin/meta"
import type { PluginSource } from "@/plugin/shared"
import type { HostPluginApi, HostSlots } from "./slots"

export type PluginLoad = {
  options: ConfigPlugin.Options | undefined
  spec: string
  target: string
  retry: boolean
  source: PluginSource | "internal"
  id: string
  module: TuiPluginModule
  origin: ConfigPlugin.Origin
  plugin_root: string
  theme_files: string[]
}

export type PluginScope = {
  lifecycle: TuiPluginApi["lifecycle"]
  track: (fn: (() => void) | undefined) => () => void
  dispose: () => Promise<void>
}

export type PluginEntry = {
  id: string
  load: PluginLoad
  meta: TuiPluginMeta
  themes: Record<string, PluginMeta.Theme>
  plugin: TuiPlugin
  enabled: boolean
  scope?: PluginScope
}

export type RuntimeActions = {
  list: (state: RuntimeState) => TuiPluginStatus[]
  activate: (state: RuntimeState | undefined, id: string, persist: boolean) => Promise<boolean>
  deactivate: (state: RuntimeState | undefined, id: string, persist: boolean) => Promise<boolean>
  add: (state: RuntimeState | undefined, spec: string) => Promise<boolean>
  install: (state: RuntimeState | undefined, spec: string, global?: boolean) => Promise<TuiPluginInstallResult>
}

export type RuntimeState = {
  directory: string
  api: HostPluginApi
  dispose?: () => void
  slots: HostSlots
  plugins: PluginEntry[]
  plugins_by_id: Map<string, PluginEntry>
  pending: Map<string, ConfigPlugin.Origin>
  install?: (spec: string, global: boolean) => Promise<OpencodeXPluginInstallResult>
  toggle?: (plugin: { id: string; source: string; internal: boolean }, enabled: boolean) => Promise<boolean>
  dispose_timeout_ms: number
  actions: RuntimeActions
}

export type CleanupResult = { type: "ok" } | { type: "error"; error: unknown } | { type: "timeout" }
export type Api = HostPluginApi
export type DisposeItem = { key: symbol; fn: TuiDispose }
