import type { AttentionItem } from "@opencode-ai/sdk/v2/work-item"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./session-api"

/** What each kind of attention looks like, so the row reads before it is read. */
export const ATTENTION_PRESENTATION: Record<AttentionItem["kind"], { icon: string; tone: string }> = {
  permission: { icon: "lock", tone: "warning" },
  input: { icon: "help", tone: "warning" },
  review: { icon: "squareCheck", tone: "review" },
  failure: { icon: "warning", tone: "failed" },
  recovery: { icon: "refresh", tone: "info" },
}

export function attentionTone(item: AttentionItem) {
  return ATTENTION_PRESENTATION[item.kind]?.tone ?? "warning"
}

export function attentionIcon(item: AttentionItem) {
  return ATTENTION_PRESENTATION[item.kind]?.icon ?? "warning"
}

/**
 * The session an attention item stands for, if the snapshot still holds it.
 * Attention that resolves to a session is rendered as that session's card, so
 * the queue and the session lists show one thing one way.
 */
export function attentionSession(item: AttentionItem, snapshot?: GuiSnapshot): Session | undefined {
  if (!item.sessionID) return undefined
  return (snapshot?.sessions ?? []).find((session) => session.id === item.sessionID)
}

/**
 * Whether the row has anywhere to go. A row that does not is rendered as plain
 * text rather than a disabled control: "disabled" reads as a button that is
 * broken, when the honest message is that there is nothing behind it to open.
 */
export function attentionOpenable(item: AttentionItem) {
  return Boolean(item.sessionID || item.swarmID)
}
