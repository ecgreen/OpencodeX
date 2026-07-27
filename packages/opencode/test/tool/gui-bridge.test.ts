import { describe, expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { GuiBridge } from "@/opencodex/gui-bridge"
import { MessageID, SessionID } from "@/session/schema"
import { BrowserScreenshotTool } from "@/tool/gui-bridge"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const url = "https://example.com/"
const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`
const requests: GuiBridge.Request[] = []

const bridge = Layer.mock(GuiBridge.Service)({
  request: (input) => {
    requests.push(input)
    if (input.operation === "browser.state") return Effect.succeed({ url })
    return Effect.succeed({ url, dataURL: png })
  },
})
const agents = Layer.mock(Agent.Service)({
  get: () => Effect.succeed({ name: "build", mode: "primary", permission: [], options: {} }),
})
const truncate = Layer.mock(Truncate.Service)({
  output: (text) => Effect.succeed({ content: text, truncated: false }),
})
const it = testEffect(Layer.mergeAll(bridge, agents, truncate))

describe("browser_screenshot", () => {
  it.effect("preflights browser state and returns a validated PNG attachment", () =>
    Effect.gen(function* () {
      requests.length = 0
      const permissions: string[] = []
      const tool = yield* Tool.init(yield* BrowserScreenshotTool)
      const result = yield* tool.execute(
        {},
        {
          sessionID: SessionID.make("ses_gui_bridge_tool"),
          directory: process.cwd(),
          messageID: MessageID.make("msg_gui_bridge_tool"),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: (input) => Effect.sync(() => permissions.push(input.patterns[0])),
        },
      )

      expect(requests.map((request) => request.operation)).toEqual(["browser.state", "browser.screenshot"])
      expect(requests[1].input).toEqual({ expectedURL: url })
      expect(permissions).toEqual([url])
      expect(result.attachments).toEqual([{ type: "file", mime: "image/png", filename: "screenshot.png", url: png }])
    }),
  )
})
