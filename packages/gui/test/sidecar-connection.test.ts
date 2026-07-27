import { describe, expect, test } from "bun:test"
import { loopbackSidecarURL } from "../src/main/sidecar-connection"

describe("sidecar connection URL", () => {
  test("accepts only HTTP loopback URLs", () => {
    expect(loopbackSidecarURL("http://127.0.0.1:4096")?.origin).toBe("http://127.0.0.1:4096")
    expect(loopbackSidecarURL("http://localhost:4096")?.origin).toBe("http://localhost:4096")
    expect(loopbackSidecarURL("http://[::1]:4096")?.origin).toBe("http://[::1]:4096")
    expect(loopbackSidecarURL("https://127.0.0.1:4096")).toBeUndefined()
    expect(loopbackSidecarURL("http://example.com:4096")).toBeUndefined()
    expect(loopbackSidecarURL("not a URL")).toBeUndefined()
  })
})
