import type { AssistantMessage, GlobalEvent } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "./store-types"

export type MessageError = NonNullable<AssistantMessage["error"]>

/**
 * A failed turn often produces no parts at all — a missing API key fails before
 * the model is ever reached. Without a rendered error the session just looks
 * empty, so every error here has to resolve to something a reader can act on.
 */
export function messageErrorTitle(error: MessageError) {
  if (error.name === "ProviderAuthError") return "Provider not connected"
  if (error.name === "MessageAbortedError") return "Interrupted"
  if (error.name === "MessageOutputLengthError") return "Response hit the output limit"
  if (error.name === "ContextOverflowError") return "Context window overflowed"
  if (error.name === "StructuredOutputError") return "Structured output failed"
  if (error.name === "APIError") return "Provider request failed"
  return "Something went wrong"
}

export function messageErrorDetail(error: MessageError) {
  const data = error.data as Record<string, unknown> | undefined
  const message = typeof data?.message === "string" ? data.message.trim() : ""
  if (error.name !== "ProviderAuthError") return message
  const providerID = messageErrorProviderID(error)
  if (!providerID) return message
  return message || `Add credentials for ${providerID} to use this model.`
}

export function messageErrorProviderID(error: MessageError) {
  if (error.name !== "ProviderAuthError") return undefined
  const providerID = (error.data as Record<string, unknown> | undefined)?.providerID
  return typeof providerID === "string" && providerID ? providerID : undefined
}

export function messageErrorStatusCode(error: MessageError) {
  if (error.name !== "APIError") return undefined
  const statusCode = (error.data as Record<string, unknown> | undefined)?.statusCode
  return typeof statusCode === "number" ? statusCode : undefined
}

/** Aborts are already shown by the composer, so they never become a notice. */
export function sessionErrorNotice(event: GlobalEvent) {
  if (event.payload.type !== "session.error") return undefined
  const error = event.payload.properties.error
  if (!error || error.name === "MessageAbortedError") return undefined
  const detail = messageErrorDetail(error)
  return detail ? `${messageErrorTitle(error)}: ${detail}` : messageErrorTitle(error)
}

export function bundleError(message: MessageBundle["info"]) {
  return message.role === "assistant" ? message.error : undefined
}
