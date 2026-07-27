export type DragSource = { type: string; id: string }

export function moveByOffset(ids: string[], sourceID: string, offset: number) {
  const sourceIndex = ids.indexOf(sourceID)
  const targetIndex = sourceIndex + offset
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= ids.length) return []
  return ids.map((id, index) => (index === sourceIndex ? ids[targetIndex] : index === targetIndex ? sourceID : id))
}

export function moveRelative(ids: string[], sourceID: string, targetID: string, placement: "before" | "after") {
  const sourceIndex = ids.indexOf(sourceID)
  const targetIndex = ids.indexOf(targetID)
  if (sourceIndex === -1 || targetIndex === -1) return []
  const withoutSource = ids.filter((id) => id !== sourceID)
  const insertionIndex = withoutSource.indexOf(targetID) + (placement === "after" ? 1 : 0)
  return [...withoutSource.slice(0, insertionIndex), sourceID, ...withoutSource.slice(insertionIndex)]
}

export function droppedReorderIDs(input: {
  ids: string[]
  source?: DragSource
  sourceType: string
  targetID: string
  placement: "before" | "after"
}) {
  if (!input.source || input.source.type !== input.sourceType || input.source.id === input.targetID) return []
  return moveRelative(input.ids, input.source.id, input.targetID, input.placement)
}

export function mergeOrderedIDs<T extends string>(ids: readonly T[], preferred: readonly string[]) {
  const allowed = new Set<string>(ids)
  const seen = new Set<string>()
  const ordered = preferred.filter((id): id is T => {
    if (!allowed.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return [...ordered, ...ids.filter((id) => !seen.has(id))]
}
