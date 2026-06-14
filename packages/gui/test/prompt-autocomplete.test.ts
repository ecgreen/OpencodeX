import { describe, expect, test } from "bun:test"
import type { Agent, Config, FileNode, McpResource } from "@opencode-ai/sdk/v2/client"
import type { PromptPart } from "../src/renderer/src/lib/store"
import { buildPromptMentionOptions, prunePromptPartsForInput, referenceSearch, restorePromptPartsFromEditedText } from "../src/renderer/src/lib/prompt-autocomplete"

describe("GUI prompt autocomplete helpers", () => {
  test("builds agent, reference, file, reference file, and MCP resource mention options", () => {
    const options = buildPromptMentionOptions({
      query: "",
      agents: [
        agent("build", "primary"),
        agent("reviewer", "subagent", "Reviews code"),
        { ...agent("hidden", "subagent"), hidden: true },
      ],
      config: { reference: { docs: "C:/Work/docs" } } as Config,
      files: [file("src/app.ts", "C:/Work/OpencodeX/src/app.ts")],
      referenceFiles: [{ alias: "docs", root: "C:/Work/docs", file: file("guide.md", "C:/Work/docs/guide.md") }],
      mcpResources: {
        "server://context": resource("context", "server://context"),
      },
    })

    expect(options.map((option) => [option.category, option.replacement])).toContainEqual(["References", "@docs"])
    expect(options.map((option) => [option.category, option.replacement])).toContainEqual(["Agents", "@reviewer"])
    expect(options.map((option) => [option.category, option.replacement])).toContainEqual(["Files", "@src/app.ts"])
    expect(options.map((option) => [option.category, option.replacement])).toContainEqual(["References", "@docs/guide.md"])
    expect(options.map((option) => [option.category, option.replacement])).toContainEqual(["MCP Resources", "@context"])
    expect(options.some((option) => option.replacement === "@build")).toBe(false)
    expect(options.some((option) => option.replacement === "@hidden")).toBe(false)
  })

  test("detects configured reference subpath searches", () => {
    expect(referenceSearch({
      query: "docs/components/button",
      config: { reference: { docs: "C:/Work/docs" } } as Config,
    })).toEqual({
      alias: "docs",
      root: "C:/Work/docs",
      query: "components/button",
    })
  })

  test("prunes structured parts when their visible mention placeholders are deleted", () => {
    const parts: PromptPart[] = [
      { type: "agent", name: "reviewer" },
      { type: "file", mime: "text/plain", filename: "src/app.ts", url: "file:///src/app.ts" },
      { type: "text", text: "plain context", synthetic: true },
    ]

    expect(prunePromptPartsForInput("please use @reviewer", parts)).toEqual([
      { type: "agent", name: "reviewer" },
      { type: "text", text: "plain context", synthetic: true },
    ])
  })

  test("preserves editor prompt parts only while their mentions remain", () => {
    const parts: PromptPart[] = [
      { type: "agent", name: "reviewer" },
      { type: "file", mime: "text/plain", filename: "src/app.ts", url: "file:///src/app.ts" },
    ]

    expect(restorePromptPartsFromEditedText(parts, "keep @src/app.ts")).toEqual([
      { type: "file", mime: "text/plain", filename: "src/app.ts", url: "file:///src/app.ts" },
    ])
  })
})

function agent(name: string, mode: Agent["mode"], description?: string): Agent {
  return {
    name,
    mode,
    description,
    permission: {},
    options: {},
  } as Agent
}

function file(path: string, absolute: string): FileNode {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    absolute,
    type: "file",
    ignored: false,
  }
}

function resource(name: string, uri: string): McpResource {
  return {
    name,
    uri,
    client: "server",
    mimeType: "text/plain",
  }
}
