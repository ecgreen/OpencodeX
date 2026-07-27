import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Provider } from "@/provider/provider"
import { Schema } from "effect"
import { OpencodeXPlugin } from "./plugin"
import { OpencodeXState } from "./state"

export const Payload = Schema.Struct({
  provider: Provider.ListResult,
  config: Config.Info,
  agents: Schema.Array(Agent.Info),
  commands: Schema.Array(Command.Info),
  lsp: Schema.Array(LSP.Status),
  formatter: Schema.Array(Format.Status),
  mcp: Schema.Record(Schema.String, MCP.Status),
  mcpResources: Schema.Record(Schema.String, MCP.Resource),
  plugins: Schema.Array(OpencodeXPlugin.Info),
}).annotate({ identifier: "OpencodeXCapabilitiesPayload" })
export type Payload = Schema.Schema.Type<typeof Payload>

export const Snapshot = Schema.Struct({
  scope: OpencodeXState.OpencodeXStateScope,
  epoch: Schema.String,
  revision: Schema.String,
  digest: Schema.String,
  payload: Payload,
}).annotate({ identifier: "OpencodeXCapabilitiesSnapshot" })
export type Snapshot = Schema.Schema.Type<typeof Snapshot>

export * as OpencodeXCapabilities from "./capabilities"
