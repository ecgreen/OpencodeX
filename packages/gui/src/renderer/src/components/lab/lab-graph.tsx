import { createSignal } from "solid-js"
import type { OpencodeXJob, Session } from "@opencode-ai/sdk/v2/client"
import { buildSessionGraph } from "../../lib/session-graph"
import { SessionSideGraph } from "../session-side-graph"
import { Section } from "./lab-shared"
import styles from "./lab.module.css"

/**
 * The workflow graph on fixture data, so the canvas can be worked on without a
 * running backend or a real swarm. Every status the node cards can show is
 * represented once.
 */
export function LabGraph() {
  const [selected, setSelected] = createSignal("")
  const graph = buildSessionGraph({
    sessionID: "root",
    workItems: [],
    sessions: SESSIONS,
    jobs: JOBS,
    swarms: [],
    // Exercises the branch-level discovery markers and the summary suffix.
    unexpanded: [{ sessionID: "migrate", reason: "depth_limit" }],
  })
  return (
    <Section
      title="Workflow graph"
      detail="Drag to pan, scroll or use the buttons to zoom, 0 fits. Hover an edge label for what the step was asked to resolve; completed and failed steps carry a corner badge as well as a tone."
    >
      <div class={styles.workspaceStage} style={{ height: "540px", resize: "vertical", overflow: "hidden" }}>
        <SessionSideGraph
          graph={graph}
          selectedNodeID={selected()}
          open={(node) => setSelected((current) => (current === node.id ? "" : node.id))}
          openFullPage={(node) => setSelected(node.id)}
          topology={{
            phase: "ready",
            refreshing: false,
            unexpanded: [{ sessionID: "migrate", reason: "depth_limit" }],
          }}
        />
      </div>
    </Section>
  )
}

function session(input: { id: string; title: string; parentID?: string; created: number }): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: "project-1",
    parentID: input.parentID,
    directory: "C:/Work/OpencodeX",
    title: input.title,
    version: "lab",
    time: { created: input.created, updated: input.created + 1000 },
    ...(input.id === "root" ? { model: { providerID: "swarm", id: "swarm-1" } } : {}),
  }
}

function job(input: Partial<OpencodeXJob> & { id: string }): OpencodeXJob {
  return {
    kind: "swarm.role",
    status: "queued",
    source: "swarm",
    attempt: 1,
    maxAttempts: 1,
    timeCreated: 1,
    timeUpdated: 2,
    ...input,
  } as OpencodeXJob
}

const SESSIONS: Session[] = [
  session({ id: "root", title: "Ship the storage migration", created: 1 }),
  {
    ...session({ id: "research", title: "Map the current schema (swarm role)", parentID: "root", created: 2 }),
    // A finished delegation's stamp: outcome plus the report's opening line,
    // which the tooltip shows as the step's summary.
    metadata: {
      opencodex: {
        delegation: {
          outcome: "succeeded",
          completedAt: 8,
          summary:
            "Mapped 14 tables and 3 views; the audit-log table is the only schema with breaking changes.",
        },
      },
    },
  },
  session({ id: "migrate", title: "Write the migration", parentID: "root", created: 3 }),
  {
    ...session({ id: "audit", title: "Audit the rollout plan", parentID: "root", created: 3 }),
    // A run-scoped record with no job row: the child returned cleanly, nothing
    // verified the work - completed, but never the green verified check.
    metadata: {
      opencodex: {
        delegation: {
          version: 2,
          runID: "run_lab_audit",
          parentSessionID: "root",
          attempt: 1,
          phase: "settled",
          outcome: "completed",
          startedAt: 6,
          completedAt: 8,
          deliveryOutcome: "delivered",
          summary: "Rollout plan holds; the only open risk is the audit-log backfill window.",
        },
      },
    },
  },
  session({ id: "tests", title: "Backfill the test suite", parentID: "root", created: 4 }),
  session({ id: "review", title: "Review the diff", parentID: "migrate", created: 5 }),
  session({ id: "docs", title: "Update the runbook", parentID: "migrate", created: 6 }),
  // No job and no live status: the honest "returned, outcome unknown" card.
  session({ id: "notes", title: "Summarize decisions", parentID: "root", created: 4 }),
]

const JOBS: OpencodeXJob[] = [
  job({ id: "job-research", sessionID: "research", status: "succeeded" }),
  job({ id: "job-migrate", sessionID: "migrate", status: "running" }),
  job({
    id: "job-tests",
    sessionID: "tests",
    status: "failed",
    failure: { code: "tests_failed", message: "3 integration tests still fail against the new schema" },
  }),
  job({ id: "job-review", sessionID: "review", status: "succeeded" }),
  job({ id: "job-docs", sessionID: "docs", status: "cancelled" }),
  job({ id: "job-pending", swarmID: "swarm-1", status: "queued", title: "Publish the release note", maxAttempts: 3 }),
]
