import { describe, expect, test } from "bun:test"
import {
  configuredBackendConnection,
  configuredBackendConnectSource,
  loopbackSidecarURL,
  restartOwnedSidecar,
} from "../src/main/sidecar-connection"

describe("sidecar connection URL", () => {
  test("accepts only HTTP loopback URLs", () => {
    expect(loopbackSidecarURL("http://127.0.0.1:4096")?.origin).toBe("http://127.0.0.1:4096")
    expect(loopbackSidecarURL("http://localhost:4096")?.origin).toBe("http://localhost:4096")
    expect(loopbackSidecarURL("http://[::1]:4096")?.origin).toBe("http://[::1]:4096")
    expect(loopbackSidecarURL("https://127.0.0.1:4096")).toBeUndefined()
    expect(loopbackSidecarURL("http://example.com:4096")).toBeUndefined()
    expect(loopbackSidecarURL("not a URL")).toBeUndefined()
  })

  test("accepts one explicitly configured canonical backend origin", () => {
    expect(
      configuredBackendConnection({
        OPENCODEX_GUI_SERVER_URL: "http://100.103.153.85:4096",
        OPENCODEX_GUI_ALLOW_INSECURE: "1",
        OPENCODEX_GUI_SERVER_USERNAME: "opencode",
        OPENCODEX_GUI_SERVER_PASSWORD: "secret",
        OPENCODEX_GUI_DIRECTORY: "/srv/project",
      }),
    ).toEqual({
      url: "http://100.103.153.85:4096",
      username: "opencode",
      password: "secret",
      directory: "/srv/project",
    })
    expect(configuredBackendConnection({})).toBeUndefined()
    expect(
      configuredBackendConnectSource(
        configuredBackendConnection({ OPENCODEX_GUI_SERVER_URL: "https://opencodex.example.test" }),
      ),
    ).toBe("https://opencodex.example.test")
    expect(() => configuredBackendConnection({ OPENCODEX_GUI_SERVER_URL: "http://100.103.153.85:4096" })).toThrow(
      "must use HTTPS",
    )
    expect(() =>
      configuredBackendConnection({
        OPENCODEX_GUI_SERVER_URL: "https://opencodex.example.test/base",
      }),
    ).toThrow("without a path")
    expect(() => configuredBackendConnection({ OPENCODEX_GUI_SERVER_URL: "file:///tmp/opencode" })).toThrow(
      "must use HTTP or HTTPS",
    )
  })

  test("restarts only a backend owned by this client", async () => {
    let restarts = 0
    const restart = async () => {
      restarts += 1
      return "restarted"
    }

    expect(await restartOwnedSidecar(undefined, restart)).toBe("restarted")
    await expect(
      restartOwnedSidecar(
        {
          url: "https://opencodex.example.test",
          username: "opencode",
          password: "",
          directory: "/srv/project",
        },
        restart,
      ),
    ).rejects.toThrow("not managed by this client")
    expect(restarts).toBe(1)
  })
})
