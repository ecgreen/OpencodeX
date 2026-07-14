import type { Session } from "@opencode-ai/sdk/v2/client"
import { isRenderableClientSession } from "@opencode-ai/sdk/v2/client-sync"

export function isRenderableSession(session: Session) {
  return isRenderableClientSession(session)
}
