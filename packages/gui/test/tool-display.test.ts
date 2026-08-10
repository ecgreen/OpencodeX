import { describe, expect, test } from "bun:test"
import type { Part, PermissionRequest } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "../src/renderer/src/lib/session-api"
import {
  collapseOutput,
  copyFullToolText,
  humanizeToolTitle,
  NESTED_TRANSCRIPT_DIFF_OPTIONS,
  patchContents,
  permissionTitle,
  permissionToolPart,
  shouldShowRawToolData,
  shouldVirtualizeDiff,
  toolCategory,
  toolDisplayTitle,
  toolErrorSummary,
  toolHasVisibleDetails,
  toolPatchTitle,
  toolTier,
  toolVisibleOutput,
} from "../src/renderer/src/lib/tool-display"

describe("GUI tool display helpers", () => {
  test("formats common tool titles from input and metadata", () => {
    expect(toolDisplayTitle("grep", { pattern: "needle", path: "src" }, { matches: 2 })).toBe('Grep "needle" in src (2 matches)')
    expect(toolDisplayTitle("grep", { pattern: "needle" }, { matches: 1 })).toBe('Grep "needle" (1 match)')
    expect(toolDisplayTitle("question", { questions: [{}] }, {})).toBe("Ask 1 question")
    expect(toolDisplayTitle("task", { subagent_type: "review", description: "check changes" }, {})).toBe("Task review: check changes")
    expect(toolDisplayTitle("workspace_open", { path: "C:/repo/README.md" }, {})).toBe("Open workspace C:/repo/README.md")
    expect(toolDisplayTitle("browser_navigate", { url: "https://example.com/" }, {})).toBe("Navigate browser https://example.com/")
    expect(toolDisplayTitle("browser_screenshot", {}, { url: "https://example.com/" })).toBe("Capture browser https://example.com/")
    expect(toolDisplayTitle("browser_snapshot", {}, { url: "https://example.com/" })).toBe("Snapshot browser https://example.com/")
  })

  test("titles Claude-shaped file inputs and harness tools", () => {
    expect(toolDisplayTitle("read", { file_path: "C:/repo/a.ts" }, {})).toBe("Read C:/repo/a.ts")
    expect(toolDisplayTitle("toolsearch", { query: "select:TaskCreate" }, {})).toBe('Search tools "select:TaskCreate"')
    expect(toolDisplayTitle("taskcreate", { subject: "Implement new feature" }, {})).toBe("Create task — Implement new feature")
    expect(toolDisplayTitle("taskupdate", { taskId: "4", status: "completed" }, {})).toBe("Update task #4 — completed")
    expect(toolDisplayTitle("taskupdate", { taskId: "4", subject: "Rename" }, {})).toBe("Update task #4")
    expect(toolDisplayTitle("tasklist", {}, {})).toBe("List tasks")
    expect(toolDisplayTitle("taskget", { taskId: "2" }, {})).toBe("Task #2")
    expect(toolDisplayTitle("agent", { subagent_type: "Explore", description: "Find lab routes" }, {})).toBe("Agent Explore: Find lab routes")
    expect(toolDisplayTitle("monitor", { action: "start" }, {})).toBe("Monitor start")
    expect(toolDisplayTitle("schedulewakeup", { delaySeconds: 300 }, {})).toBe("Schedule wakeup in 300s")
    expect(shouldShowRawToolData("taskcreate", { subject: "x" }, {})).toBe(false)
    expect(shouldShowRawToolData("toolsearch", { query: "x" }, {})).toBe(false)
  })

  test("plan_exit renders as a plan deliverable", () => {
    expect(toolDisplayTitle("plan_exit", { plan: "# Plan" }, {})).toBe("Proposed plan")
    expect(toolHasVisibleDetails("plan_exit", { plan: "# Plan" }, {}, "")).toBe(true)
  })

  test("uses verb-first titles and reports patched file counts", () => {
    expect(toolDisplayTitle("webfetch", { url: "https://example.com/" }, {})).toBe("Fetch https://example.com/")
    expect(toolDisplayTitle("websearch", { query: "solid signals" }, {})).toBe('Search "solid signals"')
    expect(toolDisplayTitle("skill", { name: "graphify" }, {})).toBe("Load skill graphify")
    expect(toolDisplayTitle("apply_patch", {}, {})).toBe("Patch")
    expect(toolDisplayTitle("apply_patch", {}, { files: [{ relativePath: "src/app.ts" }] })).toBe("Patch app.ts")
    expect(toolDisplayTitle("apply_patch", {}, { files: [{ relativePath: "a.ts" }, { relativePath: "b.ts" }] })).toBe("Patch 2 files")
    expect(toolDisplayTitle("todowrite", {}, {}, "error")).toBe("Update todos")
  })

  test("falls back to the streamed title, then a humanized tool id", () => {
    expect(toolDisplayTitle("github_create_issue", {}, {}, "running", "Creating issue #42")).toBe("Creating issue #42")
    expect(toolDisplayTitle("github_create_issue", {}, {}, "completed")).toBe("Github · create issue")
    expect(toolDisplayTitle("plan_exit", {}, {})).toBe("Proposed plan")
    expect(humanizeToolTitle("lint")).toBe("Lint")
    // A registry title always wins over a streamed one, so titles stay stable.
    expect(toolDisplayTitle("read", { filePath: "README.md" }, {}, "running", "Reading...")).toBe("Read README.md")
  })

  test("summarizes tool errors onto a single line", () => {
    expect(toolErrorSummary(errorState("  boom \n\n  happened  "))).toBe("boom happened")
    expect(toolErrorSummary(errorState("x".repeat(200)), 10)).toBe(`${"x".repeat(10)}…`)
    expect(toolErrorSummary(completedState("fine"))).toBe("")
  })

  test("maps tools to accent categories and card or row tiers", () => {
    expect(toolCategory("grep")).toBe("search")
    expect(toolCategory("apply_patch")).toBe("file")
    expect(toolCategory("todowrite")).toBe("plan")
    expect(toolCategory("some_mcp_tool")).toBe("generic")
    expect(toolTier("edit", "completed")).toBe("card")
    expect(toolTier("grep", "completed")).toBe("row")
    // Failures are always worth a card, whatever the tool.
    expect(toolTier("grep", "error")).toBe("card")
  })

  test("strips shell control sequences from visible output", () => {
    expect(toolVisibleOutput("bash", completedState("\x1B[31mred\x1B[0m"), {})).toBe("red")
    expect(toolVisibleOutput("shell", runningState(), { output: "\x1B[32mgreen\x1B[0m" })).toBe("green")
  })

  test("expands read tools only when there is a preview or an error to show", () => {
    expect(toolHasVisibleDetails("read", { filePath: "README.md" }, {}, "content")).toBe(false)
    expect(toolHasVisibleDetails("read", { filePath: "README.md" }, { preview: "   " }, "content")).toBe(false)
    expect(toolHasVisibleDetails("read", { filePath: "README.md" }, { preview: "line one" }, "")).toBe(true)
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

  test("copies the original tool text instead of its preview", async () => {
    const output = "😀".repeat(70_000)
    let copied = ""
    await copyFullToolText(output, (value) => { copied = value })
    expect(copied).toBe(output)
  })

  test("virtualizes only diffs above the conservative line or byte threshold", () => {
    expect(shouldVirtualizeDiff(Array.from({ length: 500 }, () => "line").join("\n"))).toBe(false)
    expect(shouldVirtualizeDiff(Array.from({ length: 501 }, () => "line").join("\n"))).toBe(true)
    expect(shouldVirtualizeDiff("a".repeat(64 * 1024))).toBe(false)
    expect(shouldVirtualizeDiff(`😀${"a".repeat((64 * 1024) - 3)}`)).toBe(true)
  })

  test("disables virtualization and scroll preservation for nested transcript diffs", () => {
    expect(NESTED_TRANSCRIPT_DIFF_OPTIONS).toEqual({ preserveScroll: false, virtualize: false })
  })

  test("formats permission titles and patch titles", () => {
    expect(permissionTitle(permission("read"), { filePath: "README.md" })).toBe("Read README.md")
    expect(permissionTitle(permission("doom_loop"), {})).toBe("Continue after repeated failures")
    expect(permissionTitle(permission("workspace_open"), { path: "C:/repo/README.md" })).toBe("Open workspace C:/repo/README.md")
    // URL-bearing permission headings name only the host; the full URL renders
    // in the card body where it can wrap.
    expect(permissionTitle(permission("browser_navigate"), { url: "https://example.com/some/page" })).toBe("Navigate browser example.com")
    expect(permissionTitle(permission("browser_screenshot"), { url: "https://example.com/" })).toBe("Capture browser example.com")
    expect(permissionTitle(permission("browser_snapshot"), { url: "https://example.com/" })).toBe("Snapshot browser example.com")
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

function errorState(error: string): Extract<Part, { type: "tool" }>["state"] {
  return { status: "error", error, metadata: {} } as Extract<Part, { type: "tool" }>["state"]
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
