import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createSessionMessageActionHandler } from "../src/renderer/src/components/session-message-actions"
import { messageActionAvailability, messagePromptForEdit, messagePromptForFork, messageTextForCopy, precedingUserMessage, type SessionMessageActionContext } from "../src/renderer/src/lib/message-actions"
import type { MessageBundle, SessionData } from "../src/renderer/src/lib/store-types"

describe("message actions", () => {
  test("copy text joins visible text parts and skips synthetic and ignored ones", () => {
    const bundle = bundleOf("assistant", [
      { type: "text", text: "Hello" },
      { type: "text", text: "secret", synthetic: true },
      { type: "text", text: "skipped", ignored: true },
      { type: "text", text: "world" },
    ])
    expect(messageTextForCopy(bundle)).toBe("Hello\n\nworld")
  })

  test("copy availability requires text content", () => {
    expect(messageActionAvailability(bundleOf("user", [{ type: "text", text: "hi" }]), false).copy).toBe(true)
    expect(messageActionAvailability(bundleOf("assistant", []), false).copy).toBe(false)
  })

  test("edit is only available for user messages", () => {
    expect(messageActionAvailability(bundleOf("user", []), false).edit).toBe(true)
    expect(messageActionAvailability(bundleOf("assistant", []), false).edit).toBe(false)
  })

  test("retry is only available for assistant messages", () => {
    expect(messageActionAvailability(bundleOf("assistant", []), false).retry).toBe(true)
    expect(messageActionAvailability(bundleOf("user", []), false).retry).toBe(false)
  })

  test("pending sessions disable edit, retry, and fork but keep copy", () => {
    const user = bundleOf("user", [{ type: "text", text: "hi" }])
    const availability = messageActionAvailability(user, true)
    expect(availability).toEqual({ copy: true, edit: false, retry: false, fork: false })
  })

  test("precedingUserMessage finds the closest earlier user message", () => {
    const messages = [
      bundleOf("user", [], "m1"),
      bundleOf("assistant", [], "m2"),
      bundleOf("user", [], "m3"),
      bundleOf("assistant", [], "m4"),
    ]
    expect(precedingUserMessage(messages, "m4")?.info.id).toBe("m3")
    expect(precedingUserMessage(messages, "m2")?.info.id).toBe("m1")
    expect(precedingUserMessage(messages, "m1")).toBeUndefined()
    expect(precedingUserMessage(messages, "missing")).toBeUndefined()
  })

  test("editing restores visible text, attachments, agents, and synthetic context", () => {
    const bundle = bundleOf("user", [
      { type: "text", text: "Review this" },
      { type: "text", text: "hidden context", synthetic: true },
      { type: "file", mime: "text/plain", filename: "app.ts", url: "file:///app.ts" },
      { type: "agent", name: "review" },
    ])

    expect(messagePromptForEdit(bundle)).toEqual({
      input: "Review this",
      parts: [
        { type: "text", text: "hidden context", synthetic: true },
        { type: "file", mime: "text/plain", filename: "app.ts", url: "file:///app.ts" },
        { type: "agent", name: "review" },
      ],
    })
  })

  test("forking a user message restores the same prompt and attachments as editing", () => {
    const user = bundleOf("user", [
      { type: "text", text: "Review this" },
      { type: "text", text: "hidden context", synthetic: true },
      { type: "file", mime: "text/plain", filename: "app.ts", url: "file:///app.ts" },
      { type: "agent", name: "review" },
    ])

    expect(messagePromptForFork(user)).toEqual(messagePromptForEdit(user))
    expect(messagePromptForFork(bundleOf("assistant", [{ type: "text", text: "response" }]))).toBeUndefined()
  })

  test("message action contexts recover original parts from transcript data", () => {
    const original = bundleOf("user", [
      { type: "text", text: "Review this" },
      { type: "text", text: "hidden context", synthetic: true },
      { type: "file", mime: "text/plain", filename: "app.ts", url: "file:///app.ts" },
    ])
    const visible = { ...original, parts: original.parts.filter((part) => part.type === "text" && !part.synthetic) }
    const contexts: SessionMessageActionContext[] = []
    const data: SessionData = { messages: [original], todos: [], diffs: [] }
    const action = createSessionMessageActionHandler({
      session: () => ({ id: "s" } as Session),
      data: () => data,
      onMessageAction: (_action, context) => contexts.push(context),
      restorePrompt: () => undefined,
    })

    action("edit", visible)

    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.bundle).toBe(original)
    expect(messagePromptForEdit(contexts[0]!.bundle)).toEqual({
      input: "Review this",
      parts: [
        { type: "text", text: "hidden context", synthetic: true },
        { type: "file", mime: "text/plain", filename: "app.ts", url: "file:///app.ts" },
      ],
    })
  })
})

function bundleOf(role: "user" | "assistant", parts: unknown[], id = `${role}-1`): MessageBundle {
  return {
    info: { id, role, time: { created: 1 } },
    parts: parts.map((part, index) => ({ id: `${id}-p${index}`, sessionID: "s", messageID: id, ...part })),
  } as unknown as MessageBundle
}
