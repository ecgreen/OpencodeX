import { createEffect, createSignal } from "solid-js"

export function createOverlayState() {
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = createSignal(false)

  createEffect(() => {
    if (commandPaletteOpen()) setKeyboardHelpOpen(false)
  })

  createEffect(() => {
    if (keyboardHelpOpen()) setCommandPaletteOpen(false)
  })

  return { commandPaletteOpen, setCommandPaletteOpen, keyboardHelpOpen, setKeyboardHelpOpen }
}
