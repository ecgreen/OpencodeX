export type EditContextMenuParams = {
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export type EditContextMenuItem =
  | { role: "cut" | "copy" | "paste" | "selectAll"; enabled: boolean }
  | { type: "separator" }

/**
 * Pure so the menu shape is unit-testable without Electron. `undefined`
 * means "no menu": right-clicking blank space or a graph card stays silent,
 * which keeps the in-app CardContextMenu (which preventDefaults) untouched.
 */
export function editContextMenuTemplate(params: EditContextMenuParams): EditContextMenuItem[] | undefined {
  const hasSelection = params.selectionText.trim().length > 0
  if (!params.isEditable && !hasSelection) return undefined
  return [
    ...(params.isEditable ? [{ role: "cut", enabled: params.editFlags.canCut } as const] : []),
    { role: "copy", enabled: params.editFlags.canCopy },
    ...(params.isEditable ? [{ role: "paste", enabled: params.editFlags.canPaste } as const] : []),
    { type: "separator" },
    { role: "selectAll", enabled: params.editFlags.canSelectAll },
  ]
}
