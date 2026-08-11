import { describe, expect, test } from "bun:test"
import { editContextMenuTemplate } from "../src/main/context-menu-template"

const flags = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false }

describe("edit context menu template", () => {
  test("no menu when not editable and nothing selected", () => {
    expect(editContextMenuTemplate({ isEditable: false, selectionText: "", editFlags: flags })).toBeUndefined()
  })

  test("no menu for whitespace-only selection", () => {
    expect(editContextMenuTemplate({ isEditable: false, selectionText: "  \n ", editFlags: flags })).toBeUndefined()
  })

  test("selection in read-only content offers copy and select all", () => {
    expect(editContextMenuTemplate({
      isEditable: false,
      selectionText: "hello",
      editFlags: { ...flags, canCopy: true, canSelectAll: true },
    })).toEqual([
      { role: "copy", enabled: true },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ])
  })

  test("editable field offers cut, copy, paste, select all with edit-flag states", () => {
    expect(editContextMenuTemplate({
      isEditable: true,
      selectionText: "",
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    })).toEqual([
      { role: "cut", enabled: false },
      { role: "copy", enabled: false },
      { role: "paste", enabled: true },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ])
  })
})
