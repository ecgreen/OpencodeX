import type { Session } from "@opencode-ai/sdk/v2/client"

/**
 * The stages a delegating session worked through.
 *
 * `parentID` records who spawned a step, not what it waited for. An
 * orchestrator running a relay - three designers, then a merge, then three
 * engineers - delegates every one of those itself, so parentage alone draws a
 * star with eleven identical spokes and hides the pipeline entirely. That is
 * the shape this exists to correct.
 *
 * The ordering is recoverable from execution time, and by a rule rather than a
 * tuned threshold: **work delegated while earlier work is still running is
 * concurrent; work delegated after all of it stopped is the next stage.** A
 * fan-out is issued in one turn, so its siblings overlap; a follow-on step
 * cannot be issued until its inputs are back, so it cannot overlap.
 *
 * Measured against a real relay session, this reproduces the intended pipeline
 * exactly - the three designers group, the merge that followed them does not,
 * and the three engineers after it group again - with no timing constant in it.
 *
 * The limit is worth naming: this reads "started after the last one finished"
 * as a dependency. An unrelated step delegated late still opens a new stage,
 * because nothing in the data distinguishes "next" from "also, later".
 */
export function groupSessionStages(children: readonly Session[]): Session[][] {
  const ordered = [...children].toSorted(
    (left, right) => left.time.created - right.time.created || left.id.localeCompare(right.id),
  )
  const stages: Session[][] = []
  let running = Number.NEGATIVE_INFINITY
  for (const session of ordered) {
    const current = stages.at(-1)
    // `>=` so a step delegated the instant its input landed still reads as the
    // next stage - which is exactly when an orchestrator issues one.
    if (!current || session.time.created >= running) {
      stages.push([session])
      running = sessionEnd(session)
      continue
    }
    current.push(session)
    running = Math.max(running, sessionEnd(session))
  }
  return stages
}

/**
 * When a step stopped working, as far as the catalog knows. `time.updated` is
 * the last thing that happened in the session, which for a finished delegation
 * is its final message and for a running one is now-ish - so a sibling spawned
 * beside a live step always reads as concurrent with it.
 */
function sessionEnd(session: Session) {
  return Math.max(session.time.updated, session.time.created)
}
