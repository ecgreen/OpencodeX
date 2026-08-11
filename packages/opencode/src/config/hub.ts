import { Schema } from "effect"

export const Hub = Schema.Struct({
  url: Schema.String.annotate({
    description: "Base URL of the always-on opencode hub to mirror",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Basic auth username for the hub (defaults to OPENCODE_SERVER_USERNAME)",
  }),
  password: Schema.optional(Schema.String).annotate({
    description: "Basic auth password for the hub (defaults to OPENCODE_SERVER_PASSWORD)",
  }),
}).annotate({ identifier: "HubConfig" })
export type HubConfig = Schema.Schema.Type<typeof Hub>

export * as ConfigHub from "./hub"
