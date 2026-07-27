import { create } from "@opencode-ai/core/util/log"
import { errorData, errorMessage } from "@/util/error"

export const pluginLog = create({ service: "tui.plugin" })

export function fail(message: string, data: Record<string, unknown>) {
  if (!("error" in data)) {
    pluginLog.error(message, data)
    console.error(`[tui.plugin] ${message}`, data)
    return
  }

  const text = `${message}: ${errorMessage(data.error)}`
  const next = { ...data, error: errorData(data.error) }
  pluginLog.error(text, next)
  console.error(`[tui.plugin] ${text}`, next)
}

export function warn(message: string, data: Record<string, unknown>) {
  pluginLog.warn(message, data)
  console.warn(`[tui.plugin] ${message}`, data)
}
