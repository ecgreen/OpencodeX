import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Schema } from "effect"
import { OpencodeXProject } from "@/opencodex/project"
import type { PlanService } from "@/opencodex/swarm"
import { Tool } from "./tool"

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
      "Optional explicit role plan. If omitted, OpenCodeX creates an orchestrator plus product manager, designer, architect, senior engineer, QA, and reviewer roles.",
  }),
})

type Metadata = {
  swarmID?: string
  projectID?: string
  roleCount?: number
}

export const OpencodeXSwarmCreateTool = Tool.define<typeof Parameters, Metadata, OpencodeXProject.Service | PlanService>(
  "opencodex_swarm_create",
  Effect.gen(function* () {
    const projects = yield* OpencodeXProject.Service
    const swarms = yield* (yield* Effect.promise(() => import("@/opencodex/swarm"))).PlanService

    return {
      description: [
        "Create an OpenCodeX swarm team for complex work that benefits from multiple specialist roles.",
        "Use this when the user asks to create, plan, delegate, or set up a reusable swarm/team.",
        "The tool creates the reusable team and its roles; the swarm then appears in the model picker, and selecting it routes a session to the team.",
      ].join("\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
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
          const bySession = available.find((project) =>
            project.sessions.some((session) => session.id === ctx.sessionID),
          )
          // A swarm is a model, not a project resource: a matching project just
          // becomes its default workspace, and creating without one is fine.
          const project = byID ?? byName ?? bySession ?? (available.length === 1 ? available[0] : undefined)

          const created = yield* swarms.create({
            projectID: project?.id,
            title: params.title,
            prompt: params.prompt,
            source: "manual",
            createdBy: ctx.agent,
            roles: params.roles?.map((role) => ({
              ...role,
              providerID: role.providerID ? ProviderV2.ID.make(role.providerID) : undefined,
              modelID: role.modelID ? ProviderV2.ModelID.make(role.modelID) : undefined,
            })),
            metadata: { createdByTool: "opencodex_swarm_create", sessionID: ctx.sessionID },
          })

          return {
            title: `Created team: ${created.title}`,
            output: [
              `Created OpenCodeX swarm team "${created.title}".`,
              `Team ID: ${created.id}`,
              ...(project ? [`Project: ${project.name ?? project.project.name ?? project.project.worktree}`] : []),
              `Roles: ${created.roles.map((role) => role.name).join(", ")}`,
              "",
              "Pick this team in the model selector to run a session on it, or open the swarms page to edit its roles.",
            ].join("\n"),
            metadata: {
              swarmID: created.id,
              ...(project ? { projectID: project.id } : {}),
              roleCount: created.roles.length,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
