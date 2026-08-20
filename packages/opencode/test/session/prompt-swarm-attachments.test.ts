import { describe, expect, test } from "bun:test"
import type { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Effect, Option } from "effect"
import type { Interface } from "@/opencodex/claude-driver"
import type { ClaudeImage } from "@/opencodex/claude-transport"
import { make } from "@/session/prompt-swarm"
import { SessionID } from "@/session/schema"

describe("claudeCodeTurn image attachments", () => {
  test("sends an image-only message natively and titles the session from its filename", async () => {
    const sessionID = SessionID.make("ses_image")
    const titles: string[] = []
    const turns: Array<{ text: string; images?: ClaudeImage[] }> = []
    const message = {
      info: {
        id: "msg_image",
        role: "user",
        model: { providerID: "claude-code", modelID: "sonnet" },
      },
      parts: [
        {
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,AAA=",
          filename: "architecture.png",
        },
      ],
    } as SessionLegacy.WithParts
    const { claudeCodeTurn } = make({
      claudeDriver: {
        runTurn: (input: Parameters<Interface["runTurn"]>[0]) => {
          turns.push(input)
          return Effect.succeed({ info: input, parts: [] } as never)
        },
      },
      database: {},
      sessions: {
        get: () =>
          Effect.succeed({
            id: sessionID,
            title: "New session - 2026-08-19T00:00:00.000Z",
            directory: "/workspace",
          }),
        findMessage: (_sessionID: SessionID, predicate: (message: SessionLegacy.WithParts) => boolean) =>
          Effect.succeed(predicate(message) ? Option.some(message) : Option.none()),
        setTitle: (input: { title: string }) => Effect.sync(() => titles.push(input.title)),
      },
      skills: {},
      prompt: () => Effect.die("unexpected prompt call"),
    } as never)

    const work = await Effect.runPromise(claudeCodeTurn(sessionID))
    expect(work).toBeDefined()
    await Effect.runPromise(work!)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      text: "",
      images: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "AAA=" },
        },
      ],
    })
    expect(titles).toEqual(["architecture.png"])
  })
})
