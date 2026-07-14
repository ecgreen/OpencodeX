import { createEffect } from "solid-js"
import { createSimpleContext } from "./helper"
import { useArgs } from "./args"
import { useEvent } from "./event"
import { createLocalAgent } from "./local-agent"
import { createLocalModel } from "./local-model"
import { createLocalSession } from "./local-session"
import { type ModelSelection } from "./local-types"
import { createLocalView } from "./local-view"
import { useRoute } from "./route"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useToast } from "../ui/toast"

export { parseModel } from "./local-types"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()
    const route = useRoute()
    const activeSessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
    const isModelValid = (model: ModelSelection) =>
      Boolean(sync.data.provider.find((provider) => provider.id === model.providerID)?.models[model.modelID])
    const activeSessionSwarmID = () => {
      const sessionID = activeSessionID()
      let session = sessionID ? sync.session.get(sessionID) : undefined
      const seen = new Set<string>()
      while (session && !seen.has(session.id)) {
        seen.add(session.id)
        const opencodex = session.metadata?.opencodex
        if (opencodex && typeof opencodex === "object" && "swarmID" in opencodex && typeof opencodex.swarmID === "string") {
          return opencodex.swarmID
        }
        session = session.parentID ? sync.session.get(session.parentID) : undefined
      }
    }
    const activeSessionHasUserMessage = () => {
      const sessionID = activeSessionID()
      return sessionID ? (sync.data.message[sessionID] ?? []).some((message) => message.role === "user") : false
    }

    const agent = createLocalAgent(sync, toast)
    const model = createLocalModel({
      sync,
      sdk,
      toast,
      args: useArgs(),
      agent,
      activeSessionID,
      activeSessionSwarmID,
      activeSessionHasUserMessage,
      isModelValid,
    })
    const session = createLocalSession({ sync, sdk, route, event: useEvent() })
    const view = createLocalView()

    createEffect(() => {
      const value = agent.current()
      if (!value?.model || isModelValid(value.model)) return
      toast.show({
        variant: "warning",
        message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
        duration: 3000,
      })
    })

    return {
      model,
      agent,
      session,
      view,
      mcp: {
        isEnabled(name: string) {
          return sync.data.mcp[name]?.status === "connected"
        },
        async toggle(name: string) {
          if (sync.data.mcp[name]?.status === "connected") {
            await sdk.client.mcp.disconnect({ name })
            return
          }
          await sdk.client.mcp.connect({ name })
        },
      },
    }
  },
})
