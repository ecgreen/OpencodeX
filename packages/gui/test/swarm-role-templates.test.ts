import { describe, expect, test } from "bun:test"
import {
  removeSwarmRoleTemplate,
  swarmRoleTemplateFromDraft,
  templateRoleInput,
  unusedSwarmRoleTemplates,
  upsertSwarmRoleTemplate,
  type SwarmRoleTemplate,
} from "../src/renderer/src/lib/swarm-role-templates"

describe("GUI swarm role templates", () => {
  test("builds a template from a draft, trimming and requiring name and pre-prompt", () => {
    const result = swarmRoleTemplateFromDraft({ name: "  Data Migration Expert ", description: " Moves data safely ", instructions: "  Plan reversible migrations. " })
    if ("error" in result) throw new Error(result.error)

    expect(result.template.name).toBe("Data Migration Expert")
    expect(result.template.description).toBe("Moves data safely")
    expect(result.template.instructions).toBe("Plan reversible migrations.")
    expect(result.template.id).toStartWith("role-template-")
    expect(swarmRoleTemplateFromDraft({ name: " ", description: "", instructions: "x" })).toHaveProperty("error")
    expect(swarmRoleTemplateFromDraft({ name: "Named", description: "", instructions: "  " })).toHaveProperty("error")
  })

  test("keeps its id when a draft edits an existing template", () => {
    const result = swarmRoleTemplateFromDraft({ id: "role-template-keep", name: "Reviewer", description: "", instructions: "Review." })
    if ("error" in result) throw new Error(result.error)

    expect(result.template.id).toBe("role-template-keep")
  })

  test("upserts by id without reordering, and removes by id", () => {
    const first = template("role-template-1", "First")
    const second = template("role-template-2", "Second")
    const edited = { ...first, instructions: "Changed." }

    expect(upsertSwarmRoleTemplate([first, second], edited).map((item) => item.instructions)).toEqual(["Changed.", "Do the work."])
    expect(upsertSwarmRoleTemplate([first], second).map((item) => item.id)).toEqual(["role-template-1", "role-template-2"])
    expect(removeSwarmRoleTemplate([first, second], "role-template-1").map((item) => item.id)).toEqual(["role-template-2"])
  })

  test("stamps a swarm role carrying the pre-prompt and no built-in skill", () => {
    const role = templateRoleInput(template("role-template-1", "Data Migration Expert"))

    expect(role.name).toBe("Data Migration Expert")
    expect(role.instructions).toBe("Do the work.")
    expect(role.skill).toBeUndefined()
    expect(role.providerID).toBeUndefined()
  })

  test("hides templates already sitting in the roster", () => {
    const templates = [template("role-template-1", "Reviewer"), template("role-template-2", "Docs")]
    const roles = [{ name: "reviewer " }]

    expect(unusedSwarmRoleTemplates(templates, roles).map((item) => item.name)).toEqual(["Docs"])
  })
})

function template(id: string, name: string): SwarmRoleTemplate {
  return { id, name, description: "", instructions: "Do the work." }
}
