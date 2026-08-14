import { describe, expect, test } from "bun:test"
import { Rpc } from "@/util/rpc"

describe("rpc error propagation", () => {
  test("a rejected handler reaches the client instead of hanging", async () => {
    const g = globalThis as unknown as Record<string, unknown>
    const prevPost = g.postMessage
    const prevOn = g.onmessage

    const frames: string[] = []
    let workerPost: ((ev: MessageEvent) => void) | null = null
    g.postMessage = (data: string) => {
      frames.push(data)
      workerPost?.({ data } as MessageEvent)
    }
    g.onmessage = null
    try {
      Rpc.listen({
        explode: () => {
          throw new Error("boom")
        },
      } as never)

      const clientTarget = {
        postMessage: (data: string) => (g.onmessage as ((ev: MessageEvent) => void) | null)?.({ data } as MessageEvent),
        onmessage: null as ((ev: MessageEvent) => any) | null,
      }
      workerPost = (ev) => clientTarget.onmessage?.(ev)

      const client = Rpc.client<{ explode: () => string }>(clientTarget)
      await expect(client.call("explode", undefined)).rejects.toThrow("boom")
    } finally {
      g.postMessage = prevPost
      g.onmessage = prevOn
    }
  })

  test("listen posts an rpc.error frame when a handler rejects", async () => {
    const g = globalThis as unknown as Record<string, unknown>
    const prevPost = g.postMessage
    const prevOn = g.onmessage

    const frames: string[] = []
    g.postMessage = (data: string) => void frames.push(data)
    g.onmessage = null
    try {
      Rpc.listen({
        explode: async () => Promise.reject(new Error("boom")),
      } as never)
      ;(g.onmessage as ((ev: MessageEvent) => any) | null)?.({
        data: JSON.stringify({ type: "rpc.request", method: "explode", input: undefined, id: 7 }),
      } as MessageEvent)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(frames).toHaveLength(1)
      expect(JSON.parse(frames[0])).toEqual({ type: "rpc.error", error: "boom", id: 7 })
    } finally {
      g.postMessage = prevPost
      g.onmessage = prevOn
    }
  })
})
