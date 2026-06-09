import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot, MessageBundle, SessionData } from "./store"

const ACTIVE_SESSION_WINDOW_MS = 15 * 60 * 1000

export function shouldPollVisibleSession(
  status: GuiSnapshot["sessionStatus"][string] | undefined,
  session: Session,
  data?: SessionData,
  now = Date.now(),
) {
  if (status?.type === "busy" || status?.type === "retry") return true
  return data ? isLikelyActiveSession(session, data, now) : false
}

export function isLikelyActiveSession(session: Session, data: SessionData, now = Date.now()) {
  const lastAssistant = data.messages.toReversed().find(isAssistantBundle)
  const lastActivity = Math.max(session.time.updated, lastAssistant?.info.time.created ?? 0)
  if (lastActivity < now - ACTIVE_SESSION_WINDOW_MS) return false
  if (!lastAssistant || lastAssistant.info.time.completed || "finish" in lastAssistant.info && lastAssistant.info.finish) return false
  if (lastAssistant.parts.some((part) => part.type === "tool" && part.state.status === "running")) return true
  if (lastAssistant.parts.some((part) => part.type === "step-start") && !lastAssistant.parts.some((part) => part.type === "step-finish")) return true
  return lastAssistant.parts.length > 0
}

function isAssistantBundle(bundle: MessageBundle): bundle is MessageBundle & { info: AssistantMessage } {
  return bundle.info.role === "assistant"
}
