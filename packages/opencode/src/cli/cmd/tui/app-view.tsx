import { createTuiAppController } from "./app-controller"
import { registerTuiAppCommands } from "./app-commands"
import { registerTuiAppEvents } from "./app-events"
import { TuiAppShell } from "./app-shell"

export function TuiApp(props: { onSnapshot?: () => Promise<string[]> }) {
  const controller = createTuiAppController(props)
  registerTuiAppCommands(controller)
  registerTuiAppEvents(controller)
  return <TuiAppShell controller={controller} />
}
