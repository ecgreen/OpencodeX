export function pinnedSidebarItems<T extends { id: string }>(pinnedIDs: string[], items: T[]) {
  const byID = new Map(items.map((item) => [item.id, item]))
  return pinnedIDs.map((id) => byID.get(id)).filter((item): item is T => item !== undefined)
}
