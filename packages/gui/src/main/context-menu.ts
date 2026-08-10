import { Menu, type WebContents } from "electron"
import { editContextMenuTemplate, type EditContextMenuParams, type EditContextMenuItem } from "./context-menu-template.js"

export type { EditContextMenuParams, EditContextMenuItem }
export { editContextMenuTemplate }

export function attachEditContextMenu(contents: WebContents) {
  contents.on("context-menu", (_event, params) => {
    const template = editContextMenuTemplate({
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canSelectAll: params.editFlags.canSelectAll,
      },
    })
    if (!template) return
    Menu.buildFromTemplate(template).popup()
  })
}
