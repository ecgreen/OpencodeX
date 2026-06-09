import { describe, expect, test } from "bun:test"
import type { Part, PermissionRequest } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "../src/renderer/src/lib/store"
import {
  collapseOutput,
  patchContents,
  permissionTitle,
  permissionToolPart,
  shouldShowRawToolData,
  toolDisplayTitle,
  toolHasVisibleDetails,
  toolPatchTitle,
  toolVisibleOutput,
} from "../src/renderer/src/lib/tool-display"

describe("GUI tool display helpers", () => {
  test("formats common tool titles from input and metadata", () => {
    expect(toolDisplayTitle("grep", { pattern: "needle", path: "src" }, { matches: 2 })).toBe('Grep "needle" in src (2 matches)')
    expect(toolDisplayTitle("question", { questions: [{}] }, {})).toBe("Ask 1 question")
    expect(toolDisplayTitle("task", { subagent_type: "review", description: "check changes" }, {})).toBe("review task: check changes")
  })

  test("strips shell control sequences from visible output", () => {
    expect(toolVisibleOutput("bash", completedState("\x1B[31mred\x1B[0m"), {})).toBe("red")
    expect(toolVisibleOutput("shell", runningState(), { output: "\x1B[32mgreen\x1B[0m" })).toBe("green")
  })

  test("keeps read tools quiet unless there is an error", () => {
    expect(toolHasVisibleDetails("read", { filePath: "README.md" }, {}, "content")).toBe(false)
    expect(toolHasVisibleDetails("read", { filePath: "README.md" }, {}, "", "failed")).toBe(true)
  })

  test("shows raw data only for unknown tools", () => {
    expect(shouldShowRawToolData("read", { filePath: "README.md" }, {})).toBe(false)
    expect(shouldShowRawToolData("custom_tool", { value: true }, {})).toBe(true)
  })

  test("builds synthetic before and after file contents from a unified patch", () => {
    expect(patchContents("@@ -1 +1 @@\n-old\n+new", "file.ts")).toEqual({
      before: { name: "file.ts", contents: "old" },
      after: { name: "file.ts", contents: "new" },
    })
  })

  test("collapses large permission output by line and character budget", () => {
    expect(collapseOutput(["a", "b", "c"].join("\n"), 2).output).toBe("a\nb\n...")
    expect(collapseOutput("abcdef", 120, 5).output).toBe("ab...")
  })

  test("formats permission titles and patch titles", () => {
    expect(permissionTitle(permission("read"), { filePath: "README.md" })).toBe("Read README.md")
    expect(permissionTitle(permission("doom_loop"), {})).toBe("Continue after repeated failures")
    expect(toolPatchTitle("move", "new.ts", { filePath: "old.ts" })).toBe("Moved old.ts -> new.ts")
  })

  test("finds the tool part linked to a permission request", () => {
    const part = toolPart("msg_1", "call_1")
    expect(permissionToolPart({ ...permission("edit"), tool: { messageID: "msg_1", callID: "call_1" } }, [{
      info: { id: "msg_1", sessionID: "ses_tool", role: "assistant", time: { created: 1 } } as MessageBundle["info"],
      parts: [part],
    }])).toBe(part)
  })
})

function completedState(output: string): Extract<Part, { type: "tool" }>["state"] {
  return { status: "completed", output, title: "", metadata: {} } as Extract<Part, { type: "tool" }>["state"]
}

function runningState(): Extract<Part, { type: "tool" }>["state"] {
  return { status: "running", title: "", metadata: {} } as Extract<Part, { type: "tool" }>["state"]
}

function permission(value: string): PermissionRequest {
  return {
    id: "perm_tool",
    sessionID: "ses_tool",
    permission: value,
    metadata: {},
  } as PermissionRequest
}

function toolPart(messageID: string, callID: string): Extract<Part, { type: "tool" }> {
  return {
    id: "prt_tool",
    sessionID: "ses_tool",
    messageID,
    type: "tool",
    tool: "edit",
    callID,
    state: completedState("done"),
  } as Extract<Part, { type: "tool" }>
}
