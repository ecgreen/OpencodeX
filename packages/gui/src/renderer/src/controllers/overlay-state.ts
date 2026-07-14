import { createSignal } from "solid-js"

export function createOverlayState() {
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = createSignal(false)

  return { commandPaletteOpen, setCommandPaletteOpen, keyboardHelpOpen, setKeyboardHelpOpen }
}
