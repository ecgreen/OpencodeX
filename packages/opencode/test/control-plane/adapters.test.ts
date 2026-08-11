import { describe, expect, test } from "bun:test"
import { getAdapter, registerAdapter } from "../../src/control-plane/adapters"
import { HubAdapter } from "../../src/control-plane/adapters/hub"
import { ProjectV2 } from "@opencode-ai/core/project"
import type { WorkspaceInfo } from "../../src/control-plane/types"

function info(projectID: WorkspaceInfo["projectID"], type: string): WorkspaceInfo {
  return {
    id: "workspace-test" as WorkspaceInfo["id"],
    type,
    name: "workspace-test",
    branch: null,
    directory: null,
    extra: null,
    projectID,
  }
}

function adapter(dir: string) {
  return {
    name: dir,
    description: dir,
    configure(input: WorkspaceInfo) {
      return input
    },
    async create() {},
    async remove() {},
    target() {
      return {
        type: "local" as const,
        directory: dir,
      }
    },
  }
}

describe("control-plane/adapters", () => {
  test("isolates custom adapters by project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const one = ProjectV2.ID.make(`project-${Math.random().toString(36).slice(2)}`)
    const two = ProjectV2.ID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(one, type, adapter("/one"))
    registerAdapter(two, type, adapter("/two"))

    expect(await (await getAdapter(one, type)).target(info(one, type))).toEqual({
      type: "local",
      directory: "/one",
    })
    expect(await (await getAdapter(two, type)).target(info(two, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })

  test("latest install wins within a project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const id = ProjectV2.ID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(id, type, adapter("/one"))

    expect(await (await getAdapter(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/one",
    })

    registerAdapter(id, type, adapter("/two"))

    expect(await (await getAdapter(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })

  test("hub adapter resolves a remote target from persisted extra", async () => {
    const projectID = ProjectV2.ID.make(`project-${Math.random().toString(36).slice(2)}`)
    const hub = info(projectID, "hub")
    hub.name = "hub@example.test"
    hub.extra = { url: "https://hub.example.test", username: "user", password: "secret" }

    expect(await HubAdapter.target(hub)).toEqual({
      type: "remote",
      url: "https://hub.example.test",
      // Basic auth built from the persisted username/password.
      headers: { Authorization: `Basic ${btoa("user:secret")}` },
    })
  })

  test("hub adapter applies OPENCODE_HUB_* env overrides", async () => {
    const projectID = ProjectV2.ID.make(`project-${Math.random().toString(36).slice(2)}`)
    const previous = {
      OPENCODE_HUB_URL: process.env.OPENCODE_HUB_URL,
      OPENCODE_HUB_PASSWORD: process.env.OPENCODE_HUB_PASSWORD,
    }
    process.env.OPENCODE_HUB_URL = "https://override.example.test"
    process.env.OPENCODE_HUB_PASSWORD = "override-pass"
    try {
      const hub = info(projectID, "hub")
      hub.name = "hub@example.test"
      // Persisted config points at a different hub; the env vars must win.
      hub.extra = { url: "https://configured.example.test" }
      expect(await HubAdapter.target(hub)).toEqual({
        type: "remote",
        url: "https://override.example.test",
        headers: { Authorization: `Basic ${btoa("opencode:override-pass")}` },
      })
    } finally {
      if (previous.OPENCODE_HUB_URL === undefined) delete process.env.OPENCODE_HUB_URL
      else process.env.OPENCODE_HUB_URL = previous.OPENCODE_HUB_URL
      if (previous.OPENCODE_HUB_PASSWORD === undefined) delete process.env.OPENCODE_HUB_PASSWORD
      else process.env.OPENCODE_HUB_PASSWORD = previous.OPENCODE_HUB_PASSWORD
    }
  })
})
