import { createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { getPendingOpencodeXProjectSession, getPendingOpencodeXSwarmTask } from "../opencodex-session-state"
import { onOpencodeXRefresh } from "../opencodex-sidebar"
import { opencodeXProjectTitle, sessionOpencodeXSwarmID } from "./helpers"
import type { OpencodeXPromptProject, OpencodeXPromptSwarm } from "./types"

export function createPromptOpencodeXContext(input: {
  sessionID: () => string | undefined
  targetLabel: () => string | undefined
}) {
  const sdk = useSDK()
  const sync = useSync()
  const [refresh, setRefresh] = createSignal(0)
  const refreshNow = () => setRefresh((value) => value + 1)
  const [projects] = createResource(refresh, () =>
    sdk.request<OpencodeXPromptProject[]>("/experimental/opencodex/project").catch(() => [] as OpencodeXPromptProject[]),
  )
  const [swarms] = createResource(refresh, () =>
    sdk.request<OpencodeXPromptSwarm[]>("/experimental/opencodex/swarm").catch(() => [] as OpencodeXPromptSwarm[]),
  )
  onCleanup(onOpencodeXRefresh(refreshNow))

  const project = createMemo(() => {
    const sessionID = input.sessionID()
    const values = projects() ?? []
    if (sessionID) return values.find((item) => item.sessions.some((session) => session.id === sessionID))
    const pending = getPendingOpencodeXProjectSession()
    if (!pending) return undefined
    return values.find((item) => item.id === pending.projectID)
  })
  const projectName = createMemo(() => {
    const value = project()
    return value ? opencodeXProjectTitle(value) : undefined
  })
  const pendingSwarmTask = createMemo(() => getPendingOpencodeXSwarmTask())
  const swarmID = createMemo(() => {
    let session = input.sessionID() ? sync.session.get(input.sessionID()!) : undefined
    const seen = new Set<string>()
    while (session && !seen.has(session.id)) {
      seen.add(session.id)
      const value = sessionOpencodeXSwarmID(session)
      if (value) return value
      session = session.parentID ? sync.session.get(session.parentID) : undefined
    }
  })
  const swarmState = createMemo(() => {
    const id = swarmID()
    if (!id) return undefined
    const values = swarms()
    if (!values) return { id, title: undefined, loading: true, deleted: false }
    const swarm = values.find((item) => item.id === id)
    return { id, title: swarm?.title, loading: false, deleted: swarm === undefined }
  })
  const deletedSwarmSession = createMemo(() => swarmState()?.deleted === true)
  const swarmName = createMemo(() => {
    if (input.targetLabel()) return input.targetLabel()
    const pending = input.sessionID() ? undefined : pendingSwarmTask()
    if (pending) return pending.title
    const state = swarmState()
    if (!state) return undefined
    return state.deleted ? "Deleted swarm" : state.title
  })

  return {
    projects,
    swarms,
    refresh: refreshNow,
    projectName,
    pendingSwarmTask,
    swarmID,
    swarmState,
    swarmName,
    deletedSwarmSession,
  }
}
