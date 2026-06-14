import { Schema } from "effect"

export const Kind = Schema.Literals(["server", "tui"])
export type Kind = Schema.Schema.Type<typeof Kind>

export const Scope = Schema.Literals(["global", "local", "internal"])
export type Scope = Schema.Schema.Type<typeof Scope>

export const Info = Schema.Struct({
  id: Schema.String,
  pluginID: Schema.String,
  kind: Kind,
  spec: Schema.String,
  source: Schema.String,
  scope: Scope,
  enabled: Schema.Boolean,
  active: Schema.Boolean,
  canToggle: Schema.Boolean,
  target: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
}).annotate({ identifier: "OpencodeXPlugin" })
export type Info = Schema.Schema.Type<typeof Info>

export const InstallInput = Schema.Struct({
  spec: Schema.String,
  global: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "OpencodeXPluginInstallInput" })
export type InstallInput = Schema.Schema.Type<typeof InstallInput>

export const InstallItem = Schema.Struct({
  kind: Kind,
  mode: Schema.Literals(["noop", "add", "replace"]),
  file: Schema.String,
}).annotate({ identifier: "OpencodeXPluginInstallItem" })
export type InstallItem = Schema.Schema.Type<typeof InstallItem>

export const InstallResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
  dir: Schema.optional(Schema.String),
  tui: Schema.Boolean,
  server: Schema.Boolean,
  items: Schema.Array(InstallItem),
}).annotate({ identifier: "OpencodeXPluginInstallResult" })
export type InstallResult = Schema.Schema.Type<typeof InstallResult>

export const ToggleInput = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
}).annotate({ identifier: "OpencodeXPluginToggleInput" })
export type ToggleInput = Schema.Schema.Type<typeof ToggleInput>

export * as OpencodeXPlugin from "./plugin"
