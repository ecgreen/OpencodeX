import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { runCreateProjectSessionAction, runCreateSwarmAction, runCreateViewAction } from "../src/renderer/src/lib/creation-actions"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"

describe("GUI creation action workflows", () => {
  test("creates swarms through project choice and opens the swarms route", async () => {
    const calls: string[] = []

    await runCreateSwarmAction({
      projects: [project("project-1", "C:/Work/One")],
      alert: (message) => calls.push(`alert:${message}`),
      chooseProjectID: async () => "project-1",
      createSwarm: async (projectID, title, prompt) => calls.push(`swarm:${projectID}:${title}:${prompt}`),
      refresh: async () => calls.push("refresh"),
      openSwarms: () => calls.push("route:swarms"),
    })

    expect(calls).toEqual(["swarm:project-1:New swarm:", "refresh", "route:swarms"])
  })

  test("stops swarm creation when no projects are available", async () => {
    const calls: string[] = []

    await runCreateSwarmAction({
      projects: [],
      alert: (message) => calls.push(message),
      chooseProjectID: async () => "project-1",
      createSwarm: async () => calls.push("create"),
      refresh: async () => calls.push("refresh"),
      openSwarms: () => calls.push("route"),
    })

    expect(calls).toEqual(["Create or load a project before creating a swarm."])
  })

  test("creates views through session choice and opens the views route", async () => {
    const calls: string[] = []

    await runCreateViewAction({
      sessions: [session("s1")],
      alert: (message) => calls.push(`alert:${message}`),
      chooseSessionIDs: async () => ["s1"],
      createView: async (title, sessionIDs) => calls.push(`view:${title}:${sessionIDs.join(",")}`),
      refresh: async () => calls.push("refresh"),
      openViews: () => calls.push("route:views"),
    })

    expect(calls).toEqual(["view:New view:s1", "refresh", "route:views"])
  })

  test("stops view creation when no sessions or no selected sessions are available", async () => {
    const emptyCalls: string[] = []
    const cancelledCalls: string[] = []

    await runCreateViewAction({
      sessions: [],
      alert: (message) => emptyCalls.push(message),
      chooseSessionIDs: async () => ["s1"],
      createView: async () => emptyCalls.push("create"),
      refresh: async () => emptyCalls.push("refresh"),
      openViews: () => emptyCalls.push("route"),
    })
    await runCreateViewAction({
      sessions: [session("s1")],
      alert: (message) => cancelledCalls.push(message),
      chooseSessionIDs: async () => [],
      createView: async () => cancelledCalls.push("create"),
      refresh: async () => cancelledCalls.push("refresh"),
      openViews: () => cancelledCalls.push("route"),
    })

    expect(emptyCalls).toEqual(["Create or load at least one session before creating a view."])
    expect(cancelledCalls).toEqual([])
  })

  test("creates project sessions from the selected project's first folder", async () => {
    const calls: string[] = []

    await runCreateProjectSessionAction({
      projects: [project("project-1", "C:/Work/One")],
      alert: (message) => calls.push(`alert:${message}`),
      chooseProjectID: async () => "project-1",
      createSession: (projectID, directory) => calls.push(`session:${projectID}:${directory}`),
    })

    expect(calls).toEqual(["session:project-1:C:/Work/One"])
  })

  test("stops project session creation without projects or choice", async () => {
    const emptyCalls: string[] = []
    const cancelledCalls: string[] = []

    await runCreateProjectSessionAction({
      projects: [],
      alert: (message) => emptyCalls.push(message),
      chooseProjectID: async () => "project-1",
      createSession: () => emptyCalls.push("session"),
    })
    await runCreateProjectSessionAction({
      projects: [project("project-1", "C:/Work/One")],
      alert: (message) => cancelledCalls.push(message),
      chooseProjectID: async () => undefined,
      createSession: () => cancelledCalls.push("session"),
    })

    expect(emptyCalls).toEqual(["Create or load a project before creating a project session."])
    expect(cancelledCalls).toEqual([])
  })
})

function session(id: string): Session {
  return { id, directory: "C:/Work/One", time: { updated: 1 } } as Session
}

function project(id: string, directory: string): GuiSnapshot["projects"][number] {
  return {
    id,
    name: id,
    project: { id: `${id}-core`, name: id, time: { created: 1, updated: 1 } },
    folders: [{ path: directory }],
    sessions: [],
  }
}
