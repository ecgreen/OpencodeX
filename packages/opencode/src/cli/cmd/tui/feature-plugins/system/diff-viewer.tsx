/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import { DiffViewer } from "./diff-viewer-view"
import { DIFF_ROUTE } from "./diff-viewer-model"

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: DIFF_ROUTE,
      render: () => <DiffViewer api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "diff.open",
        title: "Open diff viewer",
        slashName: "diff",
        category: "VCS",
        namespace: "palette",
        run() {
          api.route.navigate(DIFF_ROUTE, {
            mode: "git",
            sessionID: "params" in api.route.current ? api.route.current.params?.sessionID : undefined,
            returnRoute: api.route.current,
          })
          api.ui.dialog.clear()
        },
      },
    ],
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: "diff.close",
        title: "Close diff viewer",
        category: "VCS",
        run() {
          const params = ("params" in api.route.current ? api.route.current.params : undefined) as
            | { returnRoute?: TuiRouteCurrent }
            | undefined
          const returnRoute = params?.returnRoute
          api.ui.dialog.clear()
          api.route.navigate(
            returnRoute?.name ?? "home",
            returnRoute && "params" in returnRoute ? returnRoute.params : undefined,
          )
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("diff", ["diff.close"]),
    enabled: () => api.route.current.name === DIFF_ROUTE,
  })
}

export default {
  id: "diff-viewer",
  tui,
}
