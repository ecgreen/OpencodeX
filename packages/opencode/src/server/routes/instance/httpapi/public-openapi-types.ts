import { QueryBooleanOpenApi } from "./groups/query"

export type OpenApiParameter = {
  name: string
  in: string
  required?: boolean
  schema?: OpenApiSchema
}

export type OpenApiOperation = {
  parameters?: OpenApiParameter[]
  responses?: Record<string, OpenApiResponse>
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: OpenApiSchema }>
  }
  security?: unknown
}

export type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>>

export type OpenApiSpec = {
  components?: {
    schemas?: Record<string, OpenApiSchema>
    securitySchemes?: Record<string, unknown>
  }
  paths?: Record<string, OpenApiPathItem>
}

export type OpenApiSchema = {
  $ref?: string
  additionalProperties?: OpenApiSchema | boolean
  allOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  description?: string
  enum?: Array<string | boolean>
  items?: OpenApiSchema
  maximum?: number
  minimum?: number
  oneOf?: OpenApiSchema[]
  pattern?: string
  prefixItems?: OpenApiSchema[]
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  type?: string
}

export type OpenApiResponse = {
  description?: string
  content?: Record<string, { schema?: OpenApiSchema }>
}

// Query schemas describe decoded Effect values, but the generated SDK needs the
// public call shape. These keep SDK callers passing numbers/booleans while the
// server still decodes string query params at runtime.
export const QueryParameterSchemas: Record<string, OpenApiSchema> = {
  "GET /experimental/session start": { type: "number" },
  "GET /experimental/session roots": QueryBooleanOpenApi,
  "GET /experimental/session archived": QueryBooleanOpenApi,
  "GET /find/file limit": { type: "integer", minimum: 1, maximum: 200 },
  "GET /experimental/session cursor": { type: "number" },
  "GET /experimental/session limit": { type: "number" },
  "GET /session start": { type: "number" },
  "GET /session roots": QueryBooleanOpenApi,
  "GET /session limit": { type: "number" },
  "GET /session/{sessionID}/message limit": { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  "GET /session/{sessionID}/message renderBudget": { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  "GET /vcs/diff context": { type: "integer", minimum: 0 },
  "GET /api/session limit": { type: "number" },
  "GET /api/session start": { type: "number" },
  "GET /api/session roots": QueryBooleanOpenApi,
  "GET /api/session/{sessionID}/message limit": { type: "number" },
}

export const LegacyComponentDescriptions: Record<string, string> = {
  LogLevel: "Log level",
  ServerConfig: "Server configuration for opencode serve and web commands",
  LayoutConfig: "@deprecated Always uses stretch layout.",
}
