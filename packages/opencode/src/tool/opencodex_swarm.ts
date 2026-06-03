import {
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Effect, Schema } from "effect"
import { OpencodeXProject } from "@/opencodex/project"
import * as Tool from "./tool"

const RoleInput = Schema.Struct({
  name: Schema.String.annotate({ description: "Role name, for example Architect or QA Engineer" }),
  instructions: Schema.String.annotate({ description: "Specific instructions for this role" }),
  agent: Schema.optional(Schema.String).annotate({ description: "Optional primary agent name to use for this role" }),
  skill: Schema.optional(Schema.String).annotate({ description: "Optional role skill name, for example architect" }),
  providerID: Schema.optional(Schema.String).annotate({ description: "Optional provider id for this role" }),
  modelID: Schema.optional(Schema.String).annotate({ description: "Optional model id for this role" }),
  modelProfile: Schema.optional(Schema.String).annotate({ description: "Optional model profile label" }),
})

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "The complex goal or task the swarm should work on" }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional short title for the swarm" }),
  projectID: Schema.optional(Schema.String).annotate({ description: "Optional OpenCodeX project id" }),
  projectName: Schema.optional(Schema.String).annotate({
    description: "Optional OpenCodeX project name or worktree substring, used when projectID is not known",
  }),
  roles: Schema.optional(Schema.Array(RoleInput)).annotate({
    description:
      "Optional explicit role plan. If omitted, OpenCodeX creates an orchestrator plus product manager, architect, senior engineer, QA, and reviewer roles.",
  }),
})

type Metadata = {
  swarmID?: string
  projectID?: string
  roleCount?: number
}

function defaultTitle(prompt: string) {
  const firstLine = prompt.trim().split(/\r?\n/)[0] ?? "New swarm"
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine || "New swarm"
}

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

function defaultRoles(prompt: string): Schema.Schema.Type<typeof RoleInput>[] {
  return [
    {
      name: "Orchestrator",
      skill: "orchestrator",
      instructions: `Coordinate the swarm, identify dependencies between roles, and produce a handoff that explains how the role outputs should be combined for this request:\n\n${prompt}`,
    },
    {
      name: "Product Manager",
      skill: "product-manager",
      instructions: `Clarify the product goal, user workflows, acceptance criteria, and tradeoffs for this request:\n\n${prompt}`,
    },
    {
      name: "Architect",
      skill: "architect",
      instructions: `Identify the technical design, integration points, data flow, and implementation risks for this request:\n\n${prompt}`,
    },
    {
      name: "Senior Engineer",
      skill: "senior-engineer",
      instructions: `Plan or implement the engineering work for this request, using architect and PM handoffs when available:\n\n${prompt}`,
    },
    {
      name: "QA Engineer",
      skill: "qa-engineer",
      instructions: `Define validation strategy, edge cases, and regression risks for this request:\n\n${prompt}`,
    },
    {
      name: "Code Reviewer",
      skill: "code-reviewer",
      instructions: `Review completed or proposed work for correctness, maintainability, regressions, and missing validation:\n\n${prompt}`,
    },
  ]
}

function isOrchestratorRole(role: Schema.Schema.Type<typeof RoleInput>) {
  return role.skill === "orchestrator" || role.name.trim().toLowerCase() === "orchestrator"
}

function validateRoles(roles: Schema.Schema.Type<typeof RoleInput>[]) {
  if (roles.length < 2) return "A swarm requires at least two agents: one Orchestrator and one other role."
  if (roles.length > 10) return "A swarm can run at most 10 agents."
  if (!isOrchestratorRole(roles[0]!)) return "A swarm requires the first role to be the Orchestrator."
  if (!roles.some((role) => !isOrchestratorRole(role))) return "A swarm requires at least one non-Orchestrator role."
  if (roles.some((role) => role.name.trim().length === 0)) return "Every swarm role needs a name."
  if (roles.some((role) => role.instructions.trim().length === 0)) return "Every swarm role needs instructions."
  return undefined
}

export const OpencodeXSwarmCreateTool = Tool.define<
  typeof Parameters,
  Metadata,
  Database.Service | OpencodeXProject.Service
>(
  "opencodex_swarm_create",
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projects = yield* OpencodeXProject.Service

    return {
      description: [
        "Create an OpenCodeX swarm team for complex work that benefits from multiple specialist roles.",
        "Use this when the user asks to create, plan, delegate, or set up a reusable swarm/team.",
        "The tool creates the reusable team and planned roles; the user can start one or more runs from the teams view.",
      ].join("\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "opencodex_swarm_create",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const available = yield* projects.list()
          const byID = params.projectID ? available.find((project) => project.id === params.projectID) : undefined
          const projectQuery = params.projectName?.trim().toLowerCase()
          const byName = projectQuery
            ? available.find((project) =>
                [project.name, project.project.name, project.project.worktree]
                  .filter((value): value is string => typeof value === "string")
                  .some((value) => value.toLowerCase().includes(projectQuery)),
              )
            : undefined
          const bySession = available.find((project) => project.sessions.some((session) => session.id === ctx.sessionID))
          const project = byID ?? byName ?? bySession ?? (available.length === 1 ? available[0] : undefined)

          if (!project) {
            return {
              title: "Project required",
              output:
                available.length === 0
                  ? "No OpenCodeX projects exist yet. Create an OpenCodeX project before creating a swarm."
                  : [
                      "Choose an OpenCodeX project before creating a swarm.",
                      "Available projects:",
                      ...available.map((item) => `- ${item.id}: ${item.name ?? item.project.name ?? item.project.worktree}`),
                    ].join("\n"),
              metadata: {},
            }
          }

          const roles = params.roles && params.roles.length > 0 ? params.roles : defaultRoles(params.prompt)
          const title = params.title?.trim() || defaultTitle(params.prompt)
          const invalid = validateRoles(roles)

          if (invalid) {
            return {
              title: "Invalid swarm plan",
              output: invalid,
              metadata: {},
            }
          }

          const swarmID = `swm_${Identifier.ascending()}`
          const now = Date.now()

          yield* db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  yield* tx
                    .insert(OpencodeXSwarmTable)
                    .values({
                      id: swarmID,
                      opencodex_project_id: project.id,
                      title,
                      prompt: params.prompt,
                      status: "planned",
                      source: "manual",
                      created_by: ctx.agent,
                      metadata_json: serializeMetadata({ createdByTool: "opencodex_swarm_create" }),
                      time_created: now,
                      time_updated: now,
                    })
                    .run()
                  yield* Effect.forEach(
                    roles,
                    (role, index) =>
                      tx
                        .insert(OpencodeXSwarmRoleTable)
                        .values({
                          id: `swr_${Identifier.ascending()}`,
                          swarm_id: swarmID,
                          name: role.name,
                          agent: role.agent,
                          skill: role.skill,
                          provider_id: role.providerID,
                          model_id: role.modelID,
                          model_profile: role.modelProfile,
                          status: "planned",
                          instructions: role.instructions,
                          sort_order: index,
                          metadata_json: undefined,
                          time_created: now,
                          time_updated: now,
                        })
                        .run(),
                    { discard: true },
                  )
                  yield* tx
                    .insert(OpencodeXSwarmEventTable)
                    .values({
                      id: `oxe_${Identifier.ascending()}`,
                      swarm_id: swarmID,
                      kind: "swarm.created",
                      message: "Swarm plan created by OpenCodeX tool",
                      metadata_json: serializeMetadata({ sessionID: ctx.sessionID }),
                      time_created: now,
                      time_updated: now,
                    })
                    .run()
                }),
              { behavior: "immediate" },
            )
            .pipe(Effect.orDie)

          return {
            title: `Created team: ${title}`,
            output: [
              `Created OpenCodeX swarm team "${title}".`,
              `Team ID: ${swarmID}`,
              `Project: ${project.name ?? project.project.name ?? project.project.worktree}`,
              `Roles: ${roles.map((role) => role.name).join(", ")}`,
              "",
              "Open the teams dashboard to inspect it or start a run.",
            ].join("\n"),
            metadata: {
              swarmID,
              projectID: project.id,
              roleCount: roles.length,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
