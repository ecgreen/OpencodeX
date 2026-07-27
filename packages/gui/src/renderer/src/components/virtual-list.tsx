import { For, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { virtualWindow } from "../lib/virtual-window"

export function VirtualList<T>(props: {
  items: readonly T[]
  rowHeight: number
  class?: string
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"]
  ariaLabel?: string
  overscan?: number
  render: (item: T, index: number) => JSX.Element
}) {
  let viewport: HTMLDivElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(props.rowHeight * 12)
  let visibleRows = new Map<T, { item: T; index: number }>()
  const window = createMemo(() => virtualWindow({
    count: props.items.length,
    rowHeight: props.rowHeight,
    scrollTop: scrollTop(),
    viewportHeight: viewportHeight(),
    overscan: props.overscan,
  }))
  const visible = createMemo(() => {
    const next = new Map<T, { item: T; index: number }>()
    const rows = props.items.slice(window().start, window().end).map((item, index) => {
      const absolute = window().start + index
      const existing = visibleRows.get(item)
      const row = existing?.index === absolute ? existing : { item, index: absolute }
      next.set(item, row)
      return row
    })
    visibleRows = next
    return rows
  })

  onMount(() => {
    if (!viewport) return
    const measure = () => setViewportHeight(viewport?.getBoundingClientRect().height ?? 0)
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    measure()
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (!viewport) return
    const maximum = Math.max(0, window().totalHeight - viewportHeight())
    if (scrollTop() <= maximum) return
    viewport.scrollTop = maximum
    setScrollTop(maximum)
  })

  return (
    <div
      ref={(element) => { viewport = element }}
      class={`virtual-list${props.class ? ` ${props.class}` : ""}`}
      role={props.role}
      aria-label={props.ariaLabel}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div class="virtual-list-spacer" style={{ height: `${window().totalHeight}px` }}>
        <For each={visible()}>{(row) => (
          <div
            class="virtual-list-row"
            style={{ height: `${props.rowHeight}px`, transform: `translateY(${row.index * props.rowHeight}px)` }}
          >
            {props.render(row.item, row.index)}
          </div>
        )}</For>
      </div>
    </div>
  )
}
