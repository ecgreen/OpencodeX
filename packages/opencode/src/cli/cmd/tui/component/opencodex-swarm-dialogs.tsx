import { clientSwarmDisplayStatus } from "@opencode-ai/sdk/v2/swarm-presentation"
import type { useSDK } from "@tui/context/sdk"
import type { useRoute } from "@tui/context/route"
import type { useTheme } from "@tui/context/theme"
import type { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogSelect } from "@tui/ui/dialog-select"
import { setPendingOpencodeXProjectSession, setPendingOpencodeXSwarmTask } from "./opencodex-session-state"
import { projectTitle, timeAgo } from "./opencodex-operation-model"
import type { OpencodeXProject, OpencodeXSwarm } from "./opencodex-operations-types"

export async function createOpencodeXSwarmDialog(input: {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
  theme: ReturnType<typeof useTheme>["theme"]
}) {
  input.dialog.clear()
  input.route.navigate({ type: "opencodex-swarm-create" })
}

export async function selectOpencodeXSwarmDialog(input: {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
}) {
  const swarms = await input.sdk.request<OpencodeXSwarm[]>("/experimental/opencodex/swarm").catch((error: Error) => {
    void DialogAlert.show(input.dialog, "Open Swarm", error.message)
  })
  if (!swarms) return
  const projects = await input.sdk.request<OpencodeXProject[]>("/experimental/opencodex/project").catch(() => [])
  const list = swarms.toSorted((a, b) => b.timeUpdated - a.timeUpdated)
  if (list.length === 0) {
    await DialogAlert.show(input.dialog, "Open Swarm", "Create a swarm before opening one.")
    return
  }
  input.dialog.replace(() => (
    <DialogSelect
      title="Open swarm"
      placeholder="Search swarms"
      options={list.map((swarm) => ({
        title: swarm.title,
        value: swarm.id,
        description: projectTitle(projects, swarm.projectID),
        footer: `${clientSwarmDisplayStatus(swarm)} - ${swarm.roles.length} roles - ${timeAgo(swarm.timeUpdated)}`,
        onSelect: () => {
          input.dialog.clear()
          input.route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
        },
      }))}
    />
  ))
}

export async function selectOpencodeXSwarmTaskDialog(input: {
  sdk: ReturnType<typeof useSDK>
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
}) {
  const swarms = await input.sdk.request<OpencodeXSwarm[]>("/experimental/opencodex/swarm").catch((error: Error) => {
    void DialogAlert.show(input.dialog, "New Swarm Task", error.message)
  })
  if (!swarms) return
  const projects = await input.sdk.request<OpencodeXProject[]>("/experimental/opencodex/project").catch(() => [])
  const list = swarms.toSorted((a, b) => b.timeUpdated - a.timeUpdated)
  if (list.length === 0) {
    await DialogAlert.show(input.dialog, "New Swarm Task", "Create a swarm before assigning a task.")
    return
  }
  input.dialog.replace(() => (
    <DialogSelect
      title="New swarm task"
      placeholder="Search swarms"
      options={list.map((swarm) => ({
        title: swarm.title,
        value: swarm.id,
        description: projectTitle(projects, swarm.projectID),
        footer: `${clientSwarmDisplayStatus(swarm)} - ${swarm.roles.length} roles - ${timeAgo(swarm.timeUpdated)}`,
        onSelect: () => {
          input.dialog.clear()
          setPendingOpencodeXProjectSession(undefined)
          setPendingOpencodeXSwarmTask({ swarmID: swarm.id, title: swarm.title })
          input.route.navigate({ type: "home" })
        },
      }))}
    />
  ))
}
