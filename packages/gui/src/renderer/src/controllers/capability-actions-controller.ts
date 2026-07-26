import type { ProviderAuthMethod } from "@opencode-ai/sdk/v2/client"
import type { Accessor } from "solid-js"
import type { SessionSlashCommandContext } from "../lib/session-slash-commands"
import type { createDialogController } from "./dialog-controller"
import type { createNavigationController } from "./navigation-controller"
import type { GuiClient } from "../lib/client"
import { restorePromptPartsFromEditedText } from "../lib/prompt-autocomplete"
import {
  authorizeProviderOauth,
  completeProviderOauth,
  connectMcp,
  deleteView,
  disconnectMcp,
  disposeInstance,
  listConsoleOrgs,
  listMcpStatus,
  listProviderAuthMethods,
  listProviders,
  listSkills,
  setProviderApiAuth,
  switchConsoleOrg,
  type GuiSnapshot,
} from "../lib/store"

const CUSTOM_PROVIDER_OPTION = "__custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

export function createCapabilityActionsController(input: {
  client: Accessor<GuiClient | undefined>
  snapshot: Accessor<GuiSnapshot | undefined>
  navigation: ReturnType<typeof createNavigationController>
  dialogs: ReturnType<typeof createDialogController>
  refresh: () => Promise<void>
  refreshCapabilities: () => Promise<void>
  refreshAll: () => Promise<void>
  alert: (message: string) => void
}) {
  async function skills(context?: SessionSlashCommandContext) {
    const client = input.client()
    if (!client) return
    const skills = (await listSkills(client)).data ?? []
    if (skills.length === 0) return input.alert("No skills are available.")
    const name = await input.dialogs.askChoice({
      title: "Skills",
      options: skills.map((skill) => ({
        value: skill.name,
        title: skill.name,
        description: skill.description?.replace(/\s+/g, " ").trim(),
        meta: skill.location,
      })),
    })
    if (name) context?.setDraftPrompt(`/${name} `)
  }

  async function editor(sessionDirectory?: string, context?: SessionSlashCommandContext) {
    if (!window.opencodex?.editor) return input.alert("External editor support is not available in this environment.")
    const content = await window.opencodex.editor({
      value: context?.draftPrompt.trim().startsWith("/") ? "" : (context?.draftPrompt ?? ""),
      cwd: sessionDirectory || input.client()?.directory,
    })
    if (content === undefined) return input.alert("Set VISUAL or EDITOR to use /editor.")
    context?.setDraftPrompt(content)
    context?.setDraftParts?.(restorePromptPartsFromEditedText(context.draftParts ?? [], content))
  }

  async function toggleMcp() {
    const client = input.client()
    if (!client) return
    const status = (await listMcpStatus(client)).data ?? {}
    const options = Object.entries(status).map(([name, item]) => ({
      value: name,
      title: name,
      meta: item.status,
      description:
        "error" in item
          ? item.error
          : item.status === "connected"
            ? "Disconnect this MCP server"
            : "Connect this MCP server",
    }))
    if (options.length === 0) return input.alert("No MCP servers are configured.")
    const name = await input.dialogs.askChoice({
      title: "Toggle MCP",
      message: "Connected servers will be disconnected; other servers will be connected.",
      options,
    })
    if (!name) return
    if (status[name]?.status === "connected") {
      await disconnectMcp(client, name)
      await input.refreshCapabilities()
      return input.alert(`Disconnected ${name}.`)
    }
    await connectMcp(client, name)
    await input.refreshCapabilities()
    input.alert(`Connected ${name}.`)
  }

  async function switchOrg() {
    const client = input.client()
    if (!client) return
    const orgs = (await listConsoleOrgs(client)).data?.orgs ?? []
    if (orgs.length === 0) return input.alert("No Console organizations are available.")
    const value = await input.dialogs.askChoice({
      title: "Switch Org",
      options: orgs.map((org) => ({
        value: `${org.accountID}:${org.orgID}`,
        title: org.orgName,
        meta: org.active ? "active" : org.accountEmail,
        description: org.accountUrl,
      })),
    })
    const org = orgs.find((item) => `${item.accountID}:${item.orgID}` === value)
    if (!org) return
    if (org.active) return input.alert(`${org.orgName} is already active.`)
    await switchConsoleOrg(client, org.accountID, org.orgID)
    await disposeInstance(client).catch(() => undefined)
    await input.refreshAll()
    input.alert(`Switched to ${org.orgName}.`)
  }

  async function connectProvider(preselectedProviderID?: string) {
    const client = input.client()
    if (!client) return
    const providers = (await listProviders(client)).data
    const authMethods = (await listProviderAuthMethods(client)).data ?? {}
    // Entering from a specific provider (the model picker) skips the chooser.
    const providerValue = preselectedProviderID ?? await input.dialogs.askChoice({
      title: "Connect Provider",
      options: [
        ...(providers?.all ?? []).map((provider) => ({
          value: provider.id,
          title: provider.name,
          meta: providers?.connected.includes(provider.id) ? "connected" : provider.source,
          description: provider.id,
        })),
        { value: CUSTOM_PROVIDER_OPTION, title: "Other", description: "Save credentials for a custom provider ID" },
      ],
    })
    if (!providerValue) return
    const providerID =
      providerValue === CUSTOM_PROVIDER_OPTION
        ? normalizeProviderID(
            await input.dialogs.askText({
              title: "Custom Provider",
              message:
                "Provider ids must start with a lowercase letter or number and only use lowercase letters, numbers, hyphens, and underscores.",
            }),
          )
        : providerValue
    if (!providerID) return input.alert("Invalid provider ID.")
    const methods = authMethods[providerID] ?? [{ type: "api" as const, label: "API key" }]
    const methodValue =
      methods.length === 1
        ? "0"
        : await input.dialogs.askChoice({
            title: "Provider Auth",
            options: methods.map((method, index) => ({ value: String(index), title: method.label, meta: method.type })),
          })
    if (!methodValue) return
    const methodIndex = Number(methodValue)
    const method = methods[methodIndex]
    if (!method) return
    const inputs = await promptProviderInputs(method.prompts ?? [])
    if (!inputs) return
    if (method.type === "api") {
      const key = (
        await input.dialogs.askText({
          title: method.label,
          message: providerID === "opencode" ? "Enter your OpenCode Zen API key." : undefined,
        })
      )?.trim()
      if (!key) return
      await setProviderApiAuth(client, providerID, key, Object.keys(inputs).length > 0 ? inputs : undefined)
      await disposeInstance(client).catch(() => undefined)
      await input.refreshAll()
      return input.alert(`Connected ${providerID}.`)
    }
    const authorization = (await authorizeProviderOauth(client, { providerID, method: methodIndex, inputs })).data
    if (!authorization) return input.alert("No OAuth authorization details returned.")
    window.open(authorization.url, "_blank", "noopener,noreferrer")
    await navigator.clipboard.writeText(authorization.url).catch(() => undefined)
    if (authorization.method === "code") {
      const code = await input.dialogs.askText({
        title: method.label,
        message: `${authorization.instructions}\n\n${authorization.url}`,
      })
      if (!code) return
      await completeProviderOauth(client, { providerID, method: methodIndex, code })
    } else {
      const completed = await input.dialogs.askChoice({
        title: method.label,
        message: `${authorization.instructions}\n\nThe authorization URL was opened and copied to the clipboard.`,
        options: [{ value: "done", title: "I completed authorization", description: "Continue provider setup" }],
      })
      if (!completed) return
      await completeProviderOauth(client, { providerID, method: methodIndex })
    }
    await disposeInstance(client).catch(() => undefined)
    await input.refreshAll()
    input.alert(`Connected ${providerID}.`)
  }

  async function chooseView(title: string) {
    const views = input.snapshot()?.views ?? []
    if (views.length === 0) {
      input.alert("No views are available.")
      return undefined
    }
    const viewID = await input.dialogs.askChoice({
      title,
      options: views.map((view) => ({
        value: view.id,
        title: view.title,
        meta: `${view.sessions.length} sessions`,
        description: view.focusedSessionID ? `Focused session: ${view.focusedSessionID}` : undefined,
      })),
    })
    return views.find((view) => view.id === viewID)
  }

  async function deleteViewByID(viewID: string, name: string) {
    const client = input.client()
    if (!client) return
    if (!(await input.dialogs.confirm({ title: "Delete View", message: `Delete "${name}"?`, confirm: "Delete" })))
      return
    await deleteView(client, viewID)
    await input.refresh()
    const route = input.navigation.route()
    if (
      (route.name === "views" && route.viewID === viewID) ||
      (route.name === "view-edit" && route.viewID === viewID)
    )
      input.navigation.setRoute({ name: "views" })
    input.alert("View deleted.")
  }

  return {
    skills,
    editor,
    toggleMcp,
    switchOrg,
    connectProvider,
    editView: async () => {
      const view = await chooseView("Edit View")
      if (view) input.navigation.setRoute({ name: "view-edit", viewID: view.id })
    },
    deleteView: async () => {
      const view = await chooseView("Delete View")
      if (view) await deleteViewByID(view.id, view.title)
    },
    deleteViewByID,
  }

  function normalizeProviderID(value?: string) {
    const providerID = value?.trim().replace(/^@ai-sdk\//, "")
    return providerID && CUSTOM_PROVIDER_ID.test(providerID) ? providerID : undefined
  }

  async function promptProviderInputs(prompts: NonNullable<ProviderAuthMethod["prompts"]>) {
    const inputs: Record<string, string> = {}
    for (const prompt of prompts) {
      if (prompt.when) {
        const previous = inputs[prompt.when.key]
        const matches =
          previous === undefined
            ? false
            : prompt.when.op === "eq"
              ? previous === prompt.when.value
              : previous !== prompt.when.value
        if (!matches) continue
      }
      const value =
        prompt.type === "select"
          ? await input.dialogs.askChoice({
              title: prompt.message,
              options: prompt.options.map((option) => ({
                value: option.value,
                title: option.label,
                description: option.hint,
              })),
            })
          : await input.dialogs.askText({ title: prompt.message, message: prompt.placeholder })
      if (value === undefined) return undefined
      inputs[prompt.key] = value
    }
    return inputs
  }
}
