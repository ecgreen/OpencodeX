import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { View } from "./session-v2-view"

const id = "internal:session-v2-debug"
const route = "session.v2.messages"

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: route,
      render(input) {
        const sessionID = input.params?.sessionID
        if (typeof sessionID !== "string") return <text fg={api.theme.current.error}>Missing sessionID</text>
        return <View api={api} sessionID={sessionID} />
      },
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: route,
        title: "View v2 session messages",
        category: "Debug",
        namespace: "palette",
        suggested: () => api.route.current.name === "session",
        enabled: () => api.route.current.name === "session",
        run() {
          const sessionID = currentSessionID(api)
          if (!sessionID) return
          api.route.navigate(route, { sessionID })
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

const plugin: InternalTuiPlugin = { id, tui }

export default plugin

function currentSessionID(api: TuiPluginApi) {
  const current = api.route.current
  if (current.name !== "session") return
  const sessionID = current.params?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}
