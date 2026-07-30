import type { AttentionItem } from "@opencode-ai/sdk/v2/work-item"
import { clientAttentionTransitions } from "@opencode-ai/sdk/v2/work-item"
import { createEffect, onCleanup, type Accessor } from "solid-js"

export type AttentionNotification = {
  id: string
  title: string
  body: string
  sessionID?: string
}

const KIND_LABELS: Record<AttentionItem["kind"], string> = {
  permission: "Permission needed",
  input: "Input needed",
  review: "Ready for review",
  failure: "Run failed",
  recovery: "Recovered",
}

/**
 * Turns newly appeared attention items into notification payloads.
 *
 * The diff itself comes from the SDK so the GUI and the TUI agree on what
 * "newly needs a human" means. Subagent sessions are dropped for parity with
 * the TUI's notification plugin, which suppresses the OS notification (but not
 * the sound) whenever the session has a parent - a swarm of subagents would
 * otherwise bury the reader in toasts about work they never started directly.
 */
export function attentionNotifications(input: {
  previous: readonly AttentionItem[]
  next: readonly AttentionItem[]
  isSubagent: (sessionID: string) => boolean
}): AttentionNotification[] {
  return clientAttentionTransitions(input.previous, input.next)
    .filter((item) => !(item.sessionID && input.isSubagent(item.sessionID)))
    .map((item) => ({
      id: item.id,
      title: item.title || KIND_LABELS[item.kind],
      body: notificationBody(item),
      ...(item.sessionID ? { sessionID: item.sessionID } : {}),
    }))
}

function notificationBody(item: AttentionItem) {
  const label = KIND_LABELS[item.kind]
  const detail = item.detail.trim()
  return detail && detail !== label && detail !== item.title ? `${label}: ${detail}` : label
}

/**
 * Fires OS notifications for attention items that appear while the window is
 * not in front.
 *
 * The focus rule mirrors the TUI's `when: "blurred"`: a reader who is already
 * looking at the item does not need to be told about it.
 *
 * The first *ready* projection only seeds the baseline. Attention items are
 * empty until authoritative state lands, so without that seed the moment the
 * first snapshot arrives would announce every permission prompt and finished
 * run that was already outstanding before the window opened.
 */
export function createAttentionNotifications(input: {
  items: Accessor<readonly AttentionItem[]>
  enabled: Accessor<boolean>
  ready: Accessor<boolean>
  isSubagent: (sessionID: string) => boolean
  focused?: () => boolean
  show?: (notification: AttentionNotification) => void
  onActivate?: (sessionID: string) => void
}) {
  let previous: readonly AttentionItem[] = []
  let wasReady = false
  const focused = input.focused ?? windowIsFocused
  const show = input.show ?? showPlatformNotification

  if (input.onActivate) {
    const activate = input.onActivate
    const unsubscribe = window.opencodex?.notifications?.onActivate((event) => activate(event.sessionID))
    if (unsubscribe) onCleanup(unsubscribe)
  }

  createEffect(() => {
    const next = input.items()
    const ready = input.ready()
    const baseline = previous
    const announce = ready && wasReady
    previous = next
    wasReady = ready
    if (!announce || !input.enabled() || focused()) return
    attentionNotifications({ previous: baseline, next, isSubagent: input.isSubagent }).forEach(show)
  })
}

function windowIsFocused() {
  if (typeof document === "undefined") return true
  return document.visibilityState !== "hidden" && document.hasFocus()
}

function showPlatformNotification(notification: AttentionNotification) {
  window.opencodex?.notifications?.show({
    title: notification.title,
    body: notification.body,
    ...(notification.sessionID ? { sessionID: notification.sessionID } : {}),
  })
}
