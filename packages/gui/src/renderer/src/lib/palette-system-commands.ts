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
      description: "Appearance, transcript, and connection preferences",
      run: () => input.actions.openRoute("settings"),
    },
    {
      name: "app.exit",
      title: "Exit the app",
      category: "System",
      run: input.actions.exitApp,
    },
    {
      name: "app.debug",
      title: "Toggle debug panel",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.console",
      title: "Toggle console",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.heap_snapshot",
      title: "Write heap snapshot",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "terminal.title.toggle",
      title: "Toggle terminal title",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.animations",
      title: "Toggle animations",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.file_context",
      title: "Toggle file context",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.diffwrap",
      title: "Toggle diff wrapping",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.paste_summary",
      title: "Toggle paste summary",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.session_directory_filter",
      title: "Toggle session directory filtering",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
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
