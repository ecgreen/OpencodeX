import type { GuiClient } from "./client"
import { authHeaders } from "./store-auth"

export async function listMcpStatus(gui: GuiClient) {
  return gui.client.mcp.status({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function connectMcp(gui: GuiClient, name: string) {
  return gui.client.mcp.connect({ name, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function disconnectMcp(gui: GuiClient, name: string) {
  return gui.client.mcp.disconnect({ name, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listConsoleOrgs(gui: GuiClient) {
  return gui.client.experimental.console.listOrgs({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function switchConsoleOrg(gui: GuiClient, accountID: string, orgID: string) {
  return gui.client.experimental.console.switchOrg({ accountID, orgID, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function syncWorkspaces(gui: GuiClient) {
  return gui.client.experimental.workspace.syncList({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listWorkspaces(gui: GuiClient) {
  return gui.client.experimental.workspace.list({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function workspaceStatus(gui: GuiClient) {
  return gui.client.experimental.workspace.status({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function removeWorkspace(gui: GuiClient, id: string) {
  return gui.client.experimental.workspace.remove({ id, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function warpSessionWorkspace(gui: GuiClient, input: { id: string | null; sessionID: string; copyChanges?: boolean }) {
  return gui.client.experimental.workspace.warp({
    directory: gui.directory || undefined,
    id: input.id,
    sessionID: input.sessionID,
    copyChanges: input.copyChanges,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function disposeInstance(gui: GuiClient) {
  return gui.client.instance.dispose({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listProviders(gui: GuiClient) {
  return gui.client.provider.list({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listProviderAuthMethods(gui: GuiClient) {
  return gui.client.provider.auth({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function setProviderApiAuth(gui: GuiClient, providerID: string, key: string, metadata?: Record<string, string>) {
  return gui.client.auth.set({
    providerID,
    auth: {
      type: "api",
      key,
      ...(metadata ? { metadata } : {}),
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function authorizeProviderOauth(gui: GuiClient, input: { providerID: string; method: number; inputs?: Record<string, string> }) {
  return gui.client.provider.oauth.authorize({
    directory: gui.directory || undefined,
    providerID: input.providerID,
    method: input.method,
    inputs: input.inputs,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function completeProviderOauth(gui: GuiClient, input: { providerID: string; method: number; code?: string }) {
  return gui.client.provider.oauth.callback({
    directory: gui.directory || undefined,
    providerID: input.providerID,
    method: input.method,
    code: input.code,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listSkills(gui: GuiClient) {
  return gui.client.app.skills({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}
