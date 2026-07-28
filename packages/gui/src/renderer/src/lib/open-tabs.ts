export type OpenTabLayoutMeasurements = {
  tabs: Record<string, number>
  overflow: Record<number, number>
  newTab: number
  padding: number
  gap: number
}

export const OPEN_TAB_LAYOUT_FALLBACK_MEASUREMENTS: OpenTabLayoutMeasurements = {
  tabs: {},
  overflow: {},
  newTab: 30,
  padding: 16,
  gap: 4,
}

/* Matches the CSS minimum tab width (plus its border): tabs are flexible, so
   the fit decision packs by minimum width and CSS stretches the survivors. */
const OPEN_TAB_LAYOUT_FALLBACK_TAB_WIDTH = 122
const OPEN_TAB_LAYOUT_FALLBACK_OVERFLOW_WIDTH = 72

export function visibleOpenTabIDs(input: {
  ids: string[]
  activeID: string
  width: number
  measurements: OpenTabLayoutMeasurements
}) {
  if (input.ids.length <= 1) return input.ids
  if (input.width <= 0) return input.ids.includes(input.activeID) ? [input.activeID] : input.ids.slice(0, 1)
  if (openTabLayoutWidth({ ids: input.ids, hiddenCount: 0, measurements: input.measurements }) <= input.width) return input.ids
  return Array.from({ length: input.ids.length }, (_, index) => input.ids.length - 1 - index)
    .map((count) => openTabCandidateIDs(input.ids, input.activeID, count))
    .find((ids) => openTabLayoutWidth({ ids, hiddenCount: input.ids.length - ids.length, measurements: input.measurements }) <= input.width) ?? []
}

export function openTabLayoutWidth(input: {
  ids: string[]
  hiddenCount: number
  measurements: OpenTabLayoutMeasurements
}) {
  return input.measurements.padding
    + input.ids.reduce((total, id) => total + (input.measurements.tabs[id] ?? OPEN_TAB_LAYOUT_FALLBACK_TAB_WIDTH), 0)
    + input.measurements.newTab
    + (input.hiddenCount > 0 ? input.measurements.overflow[input.hiddenCount] ?? OPEN_TAB_LAYOUT_FALLBACK_OVERFLOW_WIDTH : 0)
    + Math.max(0, input.ids.length + (input.hiddenCount > 0 ? 1 : 0)) * input.measurements.gap
}

export function numberedDuplicateOpenTabLabels(items: { id: string; label: string }[]) {
  const totals = items.reduce<Record<string, number>>((result, item) => ({
    ...result,
    [item.label]: (result[item.label] ?? 0) + 1,
  }), {})
  const counts: Record<string, number> = {}
  const used = new Set<string>()
  return Object.fromEntries(items.map((item) => {
    counts[item.label] = (counts[item.label] ?? 0) + 1
    const label = availableOpenTabLabel(item.label, totals[item.label] === 1 ? 1 : counts[item.label], used)
    used.add(label)
    return [item.id, label]
  }))
}

function availableOpenTabLabel(label: string, count: number, used: Set<string>): string {
  const candidate = count <= 1 ? label : `${label} ${count}`
  if (!used.has(candidate)) return candidate
  return availableOpenTabLabel(label, count + 1, used)
}

function openTabCandidateIDs(ids: string[], activeID: string, count: number) {
  const candidate = ids.slice(0, count)
  if (count === 0 || candidate.includes(activeID) || !ids.includes(activeID)) return candidate
  return [...candidate.slice(0, count - 1), activeID]
}
