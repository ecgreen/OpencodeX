import type { PaletteCommand } from "../components/command-palette"
import type { PaletteCommandActions } from "./palette-commands"

export function buildPaletteSystemCommands(actions: PaletteCommandActions): PaletteCommand[] {
  const input = { actions }
  return [
    {
      name: "docs.open",
      title: "Open docs",
      category: "System",
      run: input.actions.openDocs,
    },
    {
      name: "plugins.list",
      title: "Plugins",
      category: "System",
      run: () => input.actions.openRoute("plugins"),
    },
    {
      name: "plugins.install",
      title: "Install plugin",
      category: "System",
      run: input.actions.installPlugin,
    },
    {
      name: "settings.open",
      title: "Settings",
      category: "System",
      description: "Appearance, security, transcript, and connection preferences",
      run: () => input.actions.openRoute("settings"),
    },
    {
      name: "app.exit",
      title: "Exit the app",
      category: "System",
      run: input.actions.exitApp,
    },
    {
      name: "gui.composer.focus",
      title: "Focus composer",
      category: "System",
      shortcut: "Ctrl+/",
      run: input.actions.focusComposer,
    },
    {
      name: "gui.refresh",
      title: "Refresh GUI snapshot",
      category: "System",
      shortcut: "Ctrl+R",
      run: input.actions.refresh,
    },
  ]
}
