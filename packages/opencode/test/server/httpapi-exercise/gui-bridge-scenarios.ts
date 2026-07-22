import { check, object } from "./assertions"
import { http } from "./dsl"
import type { Scenario } from "./types"

const clientID = "httpapi-gui-bridge"
const token = "httpapi-gui-bridge-token-00000000"
const respond = {
  clientID,
  token,
  requestID: "gbr_httpapi_missing",
  operation: "browser.state",
  result: { status: "error", message: "intentional missing request" },
}
const sync = { clientID, token, capabilities: [], scopes: [] }
const unregister = { clientID, token, generation: "gbl_httpapi_missing" }

export const guiBridgeScenarios: Scenario[] = [
  http.protected
    .post("/global/gui-bridge/respond", "global.gui_bridge.respond")
    .global()
    .probe({ path: "/global/gui-bridge/respond", body: respond })
    .at(() => ({
      path: "/global/gui-bridge/respond",
      body: respond,
    }))
    .json(409, (body) => {
      object(body)
      check(body._tag === "ConflictError", "missing GUI bridge request should return a conflict")
      check(body.resource === "gbr_httpapi_missing", "conflict should identify the missing request")
    }),
  http.protected
    .post("/global/gui-bridge/sync", "global.gui_bridge.sync")
    .global()
    .probe({ path: "/global/gui-bridge/sync", body: sync })
    .at(() => ({
      path: "/global/gui-bridge/sync",
      body: sync,
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true, "GUI bridge sync should succeed")
      check(typeof body.generation === "string" && body.generation.startsWith("gbl_"), "sync should issue a generation")
      check(body.added === 0 && body.removed === 0 && body.unchanged === 0, "empty sync should not change scopes")
    }),
  http.protected
    .post("/global/gui-bridge/unregister", "global.gui_bridge.unregister")
    .global()
    .probe({ path: "/global/gui-bridge/unregister", body: unregister })
    .at(() => ({
      path: "/global/gui-bridge/unregister",
      body: unregister,
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true, "unregistering an absent GUI bridge lease should succeed")
    }),
]
