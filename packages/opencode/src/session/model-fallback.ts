import { SessionLegacy } from "@opencode-ai/core/session/legacy"

const exhaustionCodes = new Set([
  "insufficient_quota",
  "quota_exceeded",
  "usage_limit_reached",
  "usage_not_included",
  "billing_hard_limit_reached",
])

/** Only explicit structured usage/quota exhaustion codes may advance a role fallback. */
export function isModelFallbackError(error: SessionLegacy.Assistant["error"] | undefined) {
  if (!error || !SessionLegacy.APIError.isInstance(error) || !error.data.responseBody) return false
  const parsed = parseResponse(error.data.responseBody)
  return parsed !== undefined && hasExhaustionCode(parsed)
}

export function shouldAdvanceModelFallback(turn: readonly SessionLegacy.WithParts[], userMessageID: string) {
  const assistants = turn.filter(
    (message): message is SessionLegacy.WithParts & { info: SessionLegacy.Assistant } =>
      message.info.role === "assistant" && message.info.parentID === userMessageID,
  )
  const latest = assistants.at(-1)
  if (!latest || !isModelFallbackError(latest.info.error)) return false
  return !assistants.some((message) =>
    message.parts.some((part) => part.type !== "step-start" && part.type !== "step-finish"),
  )
}

function parseResponse(value: string) {
  if (value.length > 65_536) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function hasExhaustionCode(value: unknown): boolean {
  const pending = [{ value, depth: 0 }]
  for (let visited = 0; pending.length > 0 && visited < 256; visited++) {
    const current = pending.pop()!
    if (typeof current.value !== "object" || current.value === null) continue
    const entries = Array.isArray(current.value)
      ? current.value.map((child) => ["", child] as const)
      : Object.entries(current.value)
    for (const [key, child] of entries) {
      if ((key === "code" || key === "type") && typeof child === "string" && exhaustionCodes.has(child.toLowerCase())) {
        return true
      }
      if (current.depth < 8) pending.push({ value: child, depth: current.depth + 1 })
    }
  }
  return false
}
