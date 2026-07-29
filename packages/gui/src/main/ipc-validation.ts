export function validString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export type NotificationRequest = {
  title: string
  body: string
  sessionID?: string
}

const NOTIFICATION_TITLE_LIMIT = 80
const NOTIFICATION_BODY_LIMIT = 240
const NOTIFICATION_SESSION_ID_LIMIT = 128
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g")

/**
 * Notification text is handed to the OS shell, so it is normalized and clamped
 * here instead of trusting whatever the renderer sent. Returns `undefined` when
 * either field is missing or reduces to nothing, which the handler treats as
 * "no notification" rather than showing an empty one.
 */
export function validNotificationRequest(value: unknown): NotificationRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as { title?: unknown; body?: unknown; sessionID?: unknown }
  const title = notificationText(validString(input.title), NOTIFICATION_TITLE_LIMIT)
  const body = notificationText(validString(input.body), NOTIFICATION_BODY_LIMIT)
  if (!title || !body) return undefined
  const sessionID = validString(input.sessionID)?.trim()
  return {
    title,
    body,
    ...(sessionID ? { sessionID: sessionID.slice(0, NOTIFICATION_SESSION_ID_LIMIT) } : {}),
  }
}

function notificationText(value: string | undefined, limit: number) {
  if (value === undefined) return undefined
  const text = value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim()
  return text ? Array.from(text).slice(0, limit).join("") : undefined
}
