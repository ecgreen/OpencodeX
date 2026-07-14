import type { ToolPart } from "@opencode-ai/sdk/v2"
import type { Tool } from "@/tool/tool"

export type SessionToolProps<T> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission?: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
}

export function formatToolInput(input: Record<string, unknown>, omit?: string[]) {
  const primitives = Object.entries(input).filter(([key, value]) =>
    !omit?.includes(key) && ["string", "number", "boolean"].includes(typeof value),
  )
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}
