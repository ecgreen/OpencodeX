/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../../../src/cli/cmd/tui/context/project"
import { SDKProvider } from "../../../../src/cli/cmd/tui/context/sdk"
import { SyncProviderV2, useSyncV2 } from "../../../../src/cli/cmd/tui/context/sync-v2"
import { createEventSource, createFetch, directory, json } from "../../../fixture/tui-sdk"

describe("tui v2 sync", () => {
  test("replays events received during hydration and preserves messages on refresh failure", async () => {
    const pending = Promise.withResolvers<Response>()
    let messageLoads = 0
    let fail = false
    const calls = createFetch((url) => {
      if (url.pathname !== "/api/session/ses_test/message") return
      messageLoads += 1
      if (fail) return json({ error: "offline" }, { status: 503 })
      return pending.promise
    })
    const events = createEventSource()
    let sync!: ReturnType<typeof useSyncV2>
    const app = await testRender(() => (
      <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
        <ProjectProvider>
          <SyncProviderV2>
            <Probe ready={(value) => (sync = value)} />
          </SyncProviderV2>
        </ProjectProvider>
      </SDKProvider>
    ))

    try {
      await wait(() => Boolean(sync))
      const loading = sync.session.message.sync("ses_test")
      await wait(() => messageLoads === 1)
      events.emit(global(prompted("evt_live", "live")))
      await Bun.sleep(30)
      pending.resolve(
        json({
          items: [{ id: "msg_snapshot", type: "user", text: "snapshot", time: { created: 1 } }],
          cursor: {},
        }),
      )
      await loading

      expect(sync.data.messages.ses_test.map((message) => message.id)).toEqual(["evt_live", "msg_snapshot"])

      events.emit(global(agentSwitched("evt_agent")))
      events.emit(global(modelSwitched("evt_model")))
      await wait(() => sync.data.messages.ses_test[0]?.id === "evt_model")
      expect(sync.data.messages.ses_test.slice(0, 2).map((message) => message.type)).toEqual([
        "model-switched",
        "agent-switched",
      ])

      fail = true
      await sync.session.message.sync("ses_test")
      expect(sync.data.messages.ses_test.map((message) => message.id)).toContain("evt_live")

      events.emit(global(deleted()))
      await wait(() => sync.data.messages.ses_test === undefined)
      expect(sync.data.messages.ses_test).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })
})

function Probe(props: { ready: (sync: ReturnType<typeof useSyncV2>) => void }) {
  const sync = useSyncV2()
  onMount(() => props.ready(sync))
  return <box />
}

function global(payload: Event): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function prompted(id: string, text: string): Event {
  return {
    id,
    type: "session.next.prompted",
    properties: {
      timestamp: 2,
      sessionID: "ses_test",
      prompt: { text, files: [], agents: [], references: [] },
    },
  }
}

function agentSwitched(id: string): Event {
  return {
    id,
    type: "session.next.agent.switched",
    properties: { timestamp: 3, sessionID: "ses_test", agent: "review" },
  }
}

function modelSwitched(id: string): Event {
  return {
    id,
    type: "session.next.model.switched",
    properties: {
      timestamp: 4,
      sessionID: "ses_test",
      model: { id: "model", providerID: "provider" },
    },
  }
}

function deleted(): Event {
  return {
    id: "evt_deleted",
    type: "session.deleted",
    properties: {
      sessionID: "ses_test",
      info: {
        id: "ses_test",
        slug: "ses_test",
        projectID: "proj_test",
        directory,
        title: "Deleted",
        version: "test",
        time: { created: 1, updated: 1 },
      },
    },
  }
}

async function wait(fn: () => boolean, timeout = 2_000) {
  const started = Date.now()
  while (!fn()) {
    if (Date.now() - started > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}
