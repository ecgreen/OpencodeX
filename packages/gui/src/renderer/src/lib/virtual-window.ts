export function virtualWindow(input: {
  count: number
  rowHeight: number
  scrollTop: number
  viewportHeight: number
  overscan?: number
}) {
  const count = Math.max(0, Math.floor(input.count))
  const rowHeight = Math.max(1, input.rowHeight)
  const overscan = Math.max(0, Math.floor(input.overscan ?? 6))
  const scrollTop = Math.max(0, input.scrollTop)
  const viewportHeight = Math.max(0, input.viewportHeight)
  const start = Math.min(count, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const end = Math.min(count, Math.max(start, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan))
  return { start, end, totalHeight: count * rowHeight }
}
