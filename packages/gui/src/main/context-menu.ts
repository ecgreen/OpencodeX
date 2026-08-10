import { Menu, type WebContents } from "electron"
import { editContextMenuTemplate } from "./context-menu-template.js"

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
