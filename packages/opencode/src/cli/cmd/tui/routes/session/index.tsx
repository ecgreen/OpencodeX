import { addDefaultParsers } from "@opentui/core"
import parsers from "../../../../../../parsers-config"
import { createSessionRouteController } from "./session-controller"
import { registerSessionCommands } from "./session-commands"
import { SessionRouteView } from "./session-route-view"

addDefaultParsers(parsers.parsers)

export { InlineToolRow } from "./session-tool-core"

export function Session() {
  const controller = createSessionRouteController()
  registerSessionCommands(controller)
  return <SessionRouteView controller={controller} />
}
