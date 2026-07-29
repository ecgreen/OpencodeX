import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { clientPlanModeSwitch } from "@opencode-ai/sdk/v2/client-sync"
import { onCleanup } from "solid-js"
import { globalEventPayload } from "./live-session-patch"

/**
 * Keeps the composer's Build/Plan chip on whatever mode the session is actually
 * in.
 *
 * The model can leave or enter plan mode on its own by calling `plan_exit` /
 * `plan_enter`. The TUI already follows those transitions in its agent picker;
 * without the same wiring the GUI chip keeps claiming a mode the session has
 * left, and the next prompt is sent under the wrong agent. Switches are keyed by
 * part id so a re-delivered event cannot undo a later manual change.
 */
export function createPlanModeFollow(input: {
  subscribe: (listener: (event: GlobalEvent) => void) => () => void
  activeSessionID: () => string
  setAgent: (agent: "plan" | "build") => void
}) {
  let lastPartID: string | undefined
  onCleanup(
    input.subscribe((event) => {
      const payload = globalEventPayload(event)
      if (!payload) return
      const change = clientPlanModeSwitch(payload)
      if (!change || change.partID === lastPartID || change.sessionID !== input.activeSessionID()) return
      lastPartID = change.partID
      input.setAgent(change.agent)
    }),
  )
}
