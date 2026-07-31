import type { OpencodeXSwarmRoleInput, OpencodeXViewMember } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { authHeaders } from "./store-auth"

export async function createProject(gui: GuiClient, input: { name?: string; directory: string; folders?: string[] }) {
  return gui.client.opencodex.project.create({
    opencodeXProjectCreateInput: {
      name: input.name,
      directory: input.directory,
      folders: input.folders ?? [input.directory],
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function validateProjectFolders(gui: GuiClient, input: { projectID?: string; folders: string[] }) {
  return gui.client.opencodex.project.validate({
    opencodeXProjectValidateInput: input,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function renameProject(gui: GuiClient, projectID: string, name: string) {
  return gui.client.opencodex.project.update({ projectID, name }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateProjectFolders(gui: GuiClient, projectID: string, folders: string[]) {
  return gui.client.opencodex.project.update({ projectID, folders }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateProject(gui: GuiClient, projectID: string, input: { name: string; folders: string[] }) {
  return gui.client.opencodex.project.update({ projectID, name: input.name, folders: input.folders }, { headers: authHeaders(gui), throwOnError: true })
}

export async function reorderProjects(gui: GuiClient, projectIDs: string[]) {
  return gui.client.opencodex.project.reorder({ opencodeXProjectReorderInput: { projectIDs } }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteProject(gui: GuiClient, projectID: string) {
  return gui.client.opencodex.project.delete({ projectID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createSession(gui: GuiClient, input: { projectID?: string; directory: string; title?: string }) {
  if (input.projectID) {
    return gui.client.opencodex.session.create({
      opencodeXSessionCreateInput: {
        projectID: input.projectID,
        directory: input.directory,
        title: input.title,
      },
    }, { headers: authHeaders(gui), throwOnError: true })
  }

  return gui.client.session.create({
    directory: input.directory,
    title: input.title,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createTerminalSession(
  gui: GuiClient,
  input: { projectID?: string; directory: string; installationID: string; title?: string },
) {
  return gui.client.opencodex.terminalSession.create({
    opencodeXTerminalSessionCreateInput: {
      projectID: input.projectID,
      directory: input.directory,
      installationID: input.installationID,
      title: input.title,
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function renameSession(gui: GuiClient, sessionID: string, title: string, directory?: string) {
  return gui.client.session.update({ sessionID, directory: directory || gui.directory || undefined, title }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteSession(gui: GuiClient, sessionID: string) {
  return gui.client.opencodex.session.delete({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function moveSession(gui: GuiClient, sessionID: string, projectID: string) {
  return gui.client.opencodex.session.move({
    opencodeXSessionMoveInput: { sessionID, projectID },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function getSwarm(gui: GuiClient, swarmID: string) {
  return gui.client.opencodex.swarm.get({ swarmID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createSwarm(gui: GuiClient, input: { projectID: string; title?: string; prompt?: string; roles?: OpencodeXSwarmRoleInput[] }) {
  return gui.client.opencodex.swarm.create({
    opencodeXSwarmCreateInput: {
      projectID: input.projectID,
      title: input.title,
      prompt: input.prompt,
      source: "manual",
      roles: input.roles,
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateSwarm(gui: GuiClient, swarmID: string, input: { title?: string; roles?: OpencodeXSwarmRoleInput[]; metadata?: Record<string, unknown> }) {
  return gui.client.opencodex.swarm.update({
    swarmID,
    opencodeXSwarmUpdateInput: input,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteSwarm(gui: GuiClient, swarmID: string) {
  return gui.client.opencodex.swarm.delete({ swarmID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createView(gui: GuiClient, input: { title?: string; sessionIDs?: string[]; members?: OpencodeXViewMember[]; metadata?: Record<string, unknown> }) {
  const members = input.members ?? (input.sessionIDs ?? []).map((id): OpencodeXViewMember => ({ kind: "session", id }))
  return gui.client.opencodex.view.create({
    opencodeXViewCreateInput: {
      title: input.title,
      members,
      focusedItemID: members[0]?.id,
      layout: "auto",
      metadata: input.metadata,
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function reorderViews(gui: GuiClient, viewIDs: string[]) {
  return gui.client.opencodex.view.reorder({ opencodeXViewReorderInput: { viewIDs } }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateViewFocus(gui: GuiClient, viewID: string, expectedTimeUpdated: number, focusedItemID: string) {
  return gui.client.opencodex.view.update({ viewID, expectedTimeUpdated, focusedItemID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteView(gui: GuiClient, viewID: string) {
  return gui.client.opencodex.view.delete({ viewID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateView(gui: GuiClient, viewID: string, input: { expectedTimeUpdated: number; title?: string; sessionIDs?: string[]; members?: OpencodeXViewMember[]; focusedSessionID?: string; focusedItemID?: string; metadata?: Record<string, unknown> }) {
  return gui.client.opencodex.view.update({ viewID, ...input }, { headers: authHeaders(gui), throwOnError: true })
}

/** Resolves a gate a goal is parked on. Approving lets the graph continue. */
export function approveGoalNode(gui: GuiClient, goalID: string, nodeID: string, approved: boolean) {
  return gui.client.opencodex.goal.node.approve(
    { goalID, nodeID, approved },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

/** Stops a goal: outstanding node jobs are cancelled with it. */
export function cancelGoal(gui: GuiClient, goalID: string) {
  return gui.client.opencodex.goal.cancel({ goalID }, { headers: authHeaders(gui), throwOnError: true })
}
