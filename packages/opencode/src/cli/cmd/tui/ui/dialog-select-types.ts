import type { KeyEvent, Renderable, RGBA } from "@opentui/core"
import type { Binding } from "@opentui/keymap"
import type { JSX } from "solid-js"
import type { DialogContext } from "@tui/ui/dialog"

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  flat?: boolean
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  renderFilter?: boolean
  actions?: DialogSelectAction<T>[]
  footerHints?: DialogSelectHint[]
  bindings?: readonly Binding<Renderable, KeyEvent>[]
  current?: T
}

export interface DialogSelectOption<T = unknown> {
  title: string
  value: T
  description?: string
  details?: string[]
  footer?: JSX.Element | string
  category?: string
  categoryView?: JSX.Element
  disabled?: boolean
  bg?: RGBA
  gutter?: () => JSX.Element
  margin?: JSX.Element
  onSelect?: (context: DialogContext) => void
}

export type DialogSelectAction<T> = {
  command: string
  title: string
  side?: "left" | "right"
  disabled?: boolean
  onTrigger: (option: DialogSelectOption<T>) => void
}

export type DialogSelectHint = {
  title: string
  label: string
  side?: "left" | "right"
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
  selected: DialogSelectOption<T> | undefined
}
