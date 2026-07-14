import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useTuiConfig } from "../context/tui-config"
import { formatKeyBindings, useBindings, useKeymapSelector } from "../keymap"
import { getScrollAcceleration } from "../util/scroll"
import type { DialogContext } from "./dialog"
import type { DialogSelectOption, DialogSelectProps, DialogSelectRef } from "./dialog-select-types"

export function createDialogSelectController<T>(props: DialogSelectProps<T>, dialog: DialogContext) {
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })
  const actions = createMemo(() => props.actions ?? [])
  const actionBindings = useKeymapSelector((keymap) =>
    keymap.getCommandBindings({
      visibility: "registered",
      commands: actions().map((item) => item.command),
    }),
  )
  const actionLabels = createMemo(
    () =>
      new Map(
        actions().flatMap((action) => {
          const label = formatKeyBindings(actionBindings().get(action.command), tuiConfig)
          return label ? [[action.command, label] as const] : []
        }),
      ),
  )
  const filtered = createMemo(() => {
    const options = props.options.filter((option) => !option.disabled)
    if (props.skipFilter || props.renderFilter === false || !store.filter.trim()) return options
    return fuzzysort
      .go(store.filter.toLowerCase(), options, {
        keys: ["title", "category"],
        scoreFn: (result) => result[0].score * 2 + result[1].score,
      })
      .map((result) => result.obj)
  })
  const flatten = createMemo(() => Boolean(props.flat && store.filter.length))
  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    if (flatten()) return [["", filtered()]]
    const groups = new Map<string, DialogSelectOption<T>[]>()
    filtered().forEach((option) => groups.set(option.category ?? "", [...(groups.get(option.category ?? "") ?? []), option]))
    return [...groups]
  })
  const flat = createMemo(() => grouped().flatMap(([, options]) => options))
  const rows = createMemo(() => {
    const headers = grouped().reduce((count, [category], index) => count + (category ? (index > 0 ? 2 : 1) : 0), 0)
    return flat().reduce((count, option) => count + 1 + (option.details?.length ?? 0), headers)
  })
  const height = createMemo(() => Math.max(1, Math.min(rows(), Math.floor(dimensions().height / 2) - 6)))
  const selected = createMemo(() => flat()[store.selected])
  let scroll: ScrollBoxRenderable | undefined
  let selectionTimer: ReturnType<typeof setTimeout> | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined

  const moveTo = (index: number, center = false) => {
    if (!flat().length) return
    const next = Math.max(0, Math.min(flat().length - 1, index))
    setStore("selected", next)
    const option = flat()[next]
    if (option) props.onMove?.(option)
    if (!scroll) return
    const target = scroll.getChildren().find((child: { id?: string }) => child.id === optionID(next))
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      scroll.scrollBy(y - Math.floor(scroll.height / 2))
      return
    }
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    if (y >= 0) return
    scroll.scrollBy(y)
    if (next === 0) scroll.scrollTo(0)
  }

  const move = (direction: number) => {
    if (!flat().length) return
    moveTo((store.selected + direction + flat().length) % flat().length, true)
  }

  const submit = () => {
    setStore("input", "keyboard")
    const option = selected()
    if (!option) return
    option.onSelect?.(dialog)
    props.onSelect?.(option)
  }

  useBindings(() => {
    const enabledActions = actions().filter((item) => !item.disabled)
    return {
      commands: [
        { name: "dialog.select.prev", title: "Previous item", category: "Dialog", run: () => { setStore("input", "keyboard"); move(-1) } },
        { name: "dialog.select.next", title: "Next item", category: "Dialog", run: () => { setStore("input", "keyboard"); move(1) } },
        { name: "dialog.select.page_up", title: "Page up", category: "Dialog", run: () => { setStore("input", "keyboard"); move(-10) } },
        { name: "dialog.select.page_down", title: "Page down", category: "Dialog", run: () => { setStore("input", "keyboard"); move(10) } },
        { name: "dialog.select.home", title: "First item", category: "Dialog", run: () => { setStore("input", "keyboard"); moveTo(0) } },
        { name: "dialog.select.end", title: "Last item", category: "Dialog", run: () => { setStore("input", "keyboard"); moveTo(flat().length - 1) } },
        { name: "dialog.select.submit", title: "Select item", category: "Dialog", run: submit },
        ...enabledActions.map((action) => ({
          name: action.command,
          title: action.title,
          category: "Dialog",
          run() {
            setStore("input", "keyboard")
            const option = selected()
            if (option) action.onTrigger(option)
          },
        })),
      ],
      bindings: [
        ...tuiConfig.keybinds.gather("dialog.select", [
          "dialog.select.prev",
          "dialog.select.next",
          "dialog.select.page_up",
          "dialog.select.page_down",
          "dialog.select.home",
          "dialog.select.end",
          "dialog.select.submit",
        ]),
        ...enabledActions.flatMap((action) => tuiConfig.keybinds.get(action.command)),
        ...(props.bindings ?? []).filter(
          (binding) => typeof binding.cmd !== "string" || enabledActions.some((action) => action.command === binding.cmd),
        ),
      ],
    }
  })

  createEffect(() => {
    filtered()
    setStore("input", "keyboard")
  })
  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current === undefined) return
        const index = flat().findIndex((option) => isDeepEqual(option.value, current))
        if (index >= 0) setStore("selected", index)
      },
    ),
  )
  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      if (selectionTimer) clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => {
        if (filter.length) {
          moveTo(0, true)
          return
        }
        if (current === undefined) return
        const index = flat().findIndex((option) => isDeepEqual(option.value, current))
        if (index >= 0) moveTo(index, true)
      }, 0)
    }),
  )
  onCleanup(() => {
    if (selectionTimer) clearTimeout(selectionTimer)
    if (focusTimer) clearTimeout(focusTimer)
  })

  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
    get selected() {
      return selected()
    },
  }
  props.ref?.(ref)

  const visibleActions = createMemo(() => [
    ...actions()
      .map((action) => ({ ...action, label: actionLabels().get(action.command) ?? "" }))
      .filter((action) => !action.disabled && action.label),
    ...(props.footerHints ?? []),
  ])

  return {
    store,
    grouped,
    flat,
    selected,
    flatten,
    dimensions,
    height,
    scrollAcceleration: createMemo(() => getScrollAcceleration(tuiConfig)),
    left: createMemo(() => visibleActions().filter((item) => item.side !== "right")),
    right: createMemo(() => visibleActions().filter((item) => item.side === "right")),
    visibleActions,
    moveTo,
    optionID(option: DialogSelectOption<T>) {
      return optionID(flat().indexOf(option))
    },
    optionIndex(option: DialogSelectOption<T>) {
      return flat().indexOf(option)
    },
    setInputMode(mode: "keyboard" | "mouse") {
      setStore("input", mode)
    },
    setScroll(value: ScrollBoxRenderable) {
      scroll = value
    },
    onFilter(value: string) {
      batch(() => {
        setStore("filter", value)
        props.onFilter?.(value)
      })
    },
    focusInput(value: InputRenderable) {
      value.traits = { status: "FILTER" }
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        if (!value.isDestroyed) value.focus()
      }, 1)
    },
    selectOption(option: DialogSelectOption<T>) {
      option.onSelect?.(dialog)
      props.onSelect?.(option)
    },
  }
}

function optionID(index: number) {
  return `dialog-select-option-${index}`
}

export type DialogSelectController<T> = ReturnType<typeof createDialogSelectController<T>>
