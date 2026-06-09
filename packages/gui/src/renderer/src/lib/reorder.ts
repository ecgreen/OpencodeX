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
