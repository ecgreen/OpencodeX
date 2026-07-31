import type { OpencodeXSwarmRoleInput } from "@opencode-ai/sdk/v2/client"
import { roleInput } from "./swarm-actions"

/**
 * User-defined swarm roles. A template is what a built-in preset is - a name,
 * a line of description, and a pre-prompt - except the user wrote it. Adding
 * one to a swarm stamps a normal role; the template itself lives in the
 * library, so the same role can join any number of teams.
 */
export type SwarmRoleTemplate = {
  id: string
  name: string
  /** One line for the add-a-role list, like the preset descriptions. */
  description: string
  /** The pre-prompt. It rides in role.instructions, which the orchestrator's
   * briefing quotes and every delegated prompt is prefixed with. */
  instructions: string
}

const STORAGE_KEY = "opencodex.gui.swarmRoleTemplates"

export function readSwarmRoleTemplates(): SwarmRoleTemplate[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value) => {
      const template = readTemplate(value)
      return template ? [template] : []
    })
  } catch {
    return []
  }
}

export function writeSwarmRoleTemplates(templates: SwarmRoleTemplate[]) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch {
    return
  }
}

/** Insert or replace by id, keeping the library's order stable on edits. */
export function upsertSwarmRoleTemplate(templates: SwarmRoleTemplate[], template: SwarmRoleTemplate) {
  const index = templates.findIndex((item) => item.id === template.id)
  if (index === -1) return [...templates, template]
  return templates.map((item, itemIndex) => itemIndex === index ? template : item)
}

export function removeSwarmRoleTemplate(templates: SwarmRoleTemplate[], templateID: string) {
  return templates.filter((item) => item.id !== templateID)
}

/**
 * Normalizes a draft into a saveable template, or reports what is missing.
 * The description is optional; a role is its name and its pre-prompt.
 */
export function swarmRoleTemplateFromDraft(draft: {
  id?: string
  name: string
  description: string
  instructions: string
}): { template: SwarmRoleTemplate } | { error: string } {
  const name = draft.name.trim()
  const instructions = draft.instructions.trim()
  if (!name) return { error: "Give the role a name." }
  if (!instructions) return { error: "Write the role's pre-prompt - it is what the role is." }
  return {
    template: {
      id: draft.id ?? newSwarmRoleTemplateID(),
      name,
      description: draft.description.trim(),
      instructions,
    },
  }
}

/**
 * Stamps a swarm role from a template. `skill` stays unset: a template role is
 * defined entirely by its pre-prompt, not by a built-in skill route.
 */
export function templateRoleInput(template: SwarmRoleTemplate): OpencodeXSwarmRoleInput {
  return roleInput({ name: template.name, instructions: template.instructions })
}

/** A role already in the roster hides its template from the add list. */
export function unusedSwarmRoleTemplates(
  templates: SwarmRoleTemplate[],
  roles: readonly Pick<OpencodeXSwarmRoleInput, "name">[],
) {
  const used = new Set(roles.map((role) => role.name.trim().toLowerCase()))
  return templates.filter((template) => !used.has(template.name.trim().toLowerCase()))
}

function newSwarmRoleTemplateID() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `role-template-${crypto.randomUUID()}`
  return `role-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readTemplate(value: unknown): SwarmRoleTemplate | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const input = value as Record<string, unknown>
  if (typeof input.id !== "string" || !input.id) return undefined
  if (typeof input.name !== "string" || !input.name.trim()) return undefined
  if (typeof input.instructions !== "string" || !input.instructions.trim()) return undefined
  return {
    id: input.id,
    name: input.name,
    description: typeof input.description === "string" ? input.description : "",
    instructions: input.instructions,
  }
}
