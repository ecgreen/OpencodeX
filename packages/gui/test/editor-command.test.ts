import { describe, expect, test } from "bun:test"
import { editorCommand } from "../src/main/editor-command"

describe("external editor command", () => {
  test("parses executables and fixed arguments without invoking a shell", () => {
    expect(editorCommand("code --wait")).toEqual({ command: "code", args: ["--wait"] })
    expect(editorCommand('"C:\\Program Files\\Editor\\editor.exe" --reuse-window')).toEqual({
      command: "C:\\Program Files\\Editor\\editor.exe",
      args: ["--reuse-window"],
    })
  })

  test("rejects empty commands and preserves quoted arguments", () => {
    expect(editorCommand("  ")).toBeUndefined()
    expect(editorCommand("editor '--profile name'")).toEqual({ command: "editor", args: ["--profile name"] })
  })
})
