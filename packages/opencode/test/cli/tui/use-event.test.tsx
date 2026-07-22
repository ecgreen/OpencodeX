/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/cli/cmd/tui/context/project"
import { SDKProvider, useSDK } from "../../../src/cli/cmd/tui/context/sdk"
import { useEvent } from "../../../src/cli/cmd/tui/context/event"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"

const projectID = "proj_test"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function event(payload: Event, input: { directory: string; project?: string; workspace?: string }): GlobalEvent {
  return {
    directory: input.directory,
    project: input.project,
    workspace: input.workspace,
    payload,
  }
}

function vcs(branch: string): Event {
  return {
    id: `evt_vcs_${branch}`,
    type: "vcs.branch.updated",
    properties: {
      branch,
    },
  }
}

function update(version: string): Event {
  return {
    id: `evt_update_${version}`,
    type: "installation.update-available",
    properties: {
      version,
    },
  }
}

async function mount() {
  const events = createEventSource()
  const calls = createFetch()
  const seen: Event[] = []
  const allSeen: Event[] = []
  const batches: Event[][] = []
  const workspaces: Array<string | undefined> = []
  let project!: ReturnType<typeof useProject>
  let sdk!: ReturnType<typeof useSDK>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <SDKProvider
      url="http://test"
      directory={directory}
      events={events.source}
      fetch={calls.fetch}
      headers={{ authorization: "Basic test" }}
    >
      <ProjectProvider>
        <Probe
          onReady={async (ctx) => {
            project = ctx.project
            sdk = ctx.sdk
            await project.sync()
            done()
          }}
          seen={seen}
          allSeen={allSeen}
          batches={batches}
          workspaces={workspaces}
        />
      </ProjectProvider>
    </SDKProvider>
  ))

  await ready
  return { allSeen, app, batches, calls, emit: events.emit, project, sdk, seen, workspaces }
}

function Probe(props: {
  seen: Event[]
  allSeen: Event[]
  batches: Event[][]
  workspaces: Array<string | undefined>
  onReady: (ctx: { project: ReturnType<typeof useProject>; sdk: ReturnType<typeof useSDK> }) => void
}) {
  const project = useProject()
  const sdk = useSDK()
  const event = useEvent()

  onMount(() => {
    event.subscribe((evt, { workspace }) => {
      props.seen.push(evt)
      props.workspaces.push(workspace)
    })
    event.subscribeAll((evt) => props.allSeen.push(evt))
    event.subscribeBatchAll((events) => props.batches.push(events.map((item) => item.event)))
    props.onReady({ project, sdk })
  })

  return <box />
}

function SDKProbe(props: { onReady: (sdk: ReturnType<typeof useSDK>) => void }) {
  const sdk = useSDK()
  onMount(() => props.onReady(sdk))
  return <box />
}

describe("useEvent", () => {
  test("opens the lazy global stream before sync and reconnects after it ends", async () => {
    const order = new Array<string>()
    let sdk!: ReturnType<typeof useSDK>
    const calls = createFetch((url) => {
      if (url.pathname === "/global/event") {
        order.push("event-open")
        return globalEventStream()
      }
      if (url.pathname === "/sync/start") {
        order.push("sync-start")
        return Response.json(true)
      }
      return undefined
    })
    const app = await testRender(() => (
      <SDKProvider url="http://test" directory={directory} fetch={calls.fetch}>
        <SDKProbe onReady={(value) => (sdk = value)} />
      </SDKProvider>
    ))

    try {
      await wait(() => sdk?.eventConnectionGeneration() === 2, 3000)

      expect(order.slice(0, 4)).toEqual(["event-open", "sync-start", "event-open", "sync-start"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers events for the current directory", async () => {
    const { app, emit, seen, workspaces } = await mount()

    try {
      emit(event(vcs("main"), { directory, project: projectID, workspace: "ws_a" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("main")])
      expect(workspaces).toEqual(["ws_a"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers queued events as one normalized batch", async () => {
    const { app, batches, emit } = await mount()

    try {
      emit(event(vcs("warm"), { directory, project: projectID }))
      emit(event(vcs("batched"), { directory, project: projectID }))
      emit(event(update("1.2.3"), { directory: "global" }))

      await wait(() => batches.length === 1)

      expect(batches).toEqual([[vcs("warm"), vcs("batched"), update("1.2.3")]])
    } finally {
      app.renderer.destroy()
    }
  })

  test("ignores events for other directories", async () => {
    const { allSeen, app, emit, seen } = await mount()

    try {
      emit(event(vcs("other"), { directory: "/tmp/other", project: projectID }))
      await Bun.sleep(30)

      expect(seen).toHaveLength(0)
      expect(allSeen).toEqual([vcs("other")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers current directory events regardless of active workspace", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(vcs("ws"), { directory, project: projectID, workspace: "ws_b" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("ws")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers truly global events even when a workspace is active", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(update("1.2.3"), { directory: "global" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([update("1.2.3")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("routes and authenticates raw fetch and request calls", async () => {
    const { app, calls, sdk } = await mount()

    try {
      await sdk.fetch(new URL("/vcs", sdk.url))
      await sdk.request("/vcs")

      expect(calls.requestHeaders.at(-2)?.get("authorization")).toBe("Basic test")
      expect(calls.requestHeaders.at(-2)?.get("x-opencode-directory")).toBe(directory)
      expect(calls.requestHeaders.at(-1)?.get("authorization")).toBe("Basic test")
      expect(calls.requestHeaders.at(-1)?.get("x-opencode-directory")).toBe(directory)
    } finally {
      app.renderer.destroy()
    }
  })
})

function globalEventStream() {
  const payload = {
    directory: "global",
    payload: { id: "connected", type: "server.connected", properties: {} },
  }
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}
