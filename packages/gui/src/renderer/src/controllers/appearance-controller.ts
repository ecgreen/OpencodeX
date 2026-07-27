import { createEffect, createSignal } from "solid-js"
import { readThemeMode, type GuiThemeMode } from "../lib/app-preferences"

export function createAppearanceController() {
  const [themeMode, setThemeMode] = createSignal<GuiThemeMode>(readThemeMode())

  createEffect(() => {
    const mode = themeMode()
    document.documentElement.dataset.theme = mode
    localStorage.setItem("opencodex.gui.theme", mode)
  })

  return { themeMode, setThemeMode }
}
