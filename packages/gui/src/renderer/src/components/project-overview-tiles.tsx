import { For, Show } from "solid-js"
import type { ProjectOverviewFilter, ProjectSummary } from "../lib/project-summary"
import { Button } from "./ui"
import { Icon } from "./icon"

type TileTone = "warning" | "danger" | "info" | "special" | "neutral"

type Tile = {
  filter: ProjectOverviewFilter
  label: string
  icon: string
  value: number
  tone: TileTone
  /** How many projects the filter would leave, so a dead filter can be disabled. */
  projects: number
}

/**
 * The page's state in four numbers. Each tile is also the filter for what it
 * counts, so a count you care about is one click from the list that explains it.
 */
export function ProjectOverviewTiles(props: {
  summaries: ProjectSummary[]
  filter: ProjectOverviewFilter
  setFilter: (filter: ProjectOverviewFilter) => void
}) {
  const attentionItems = () => props.summaries.reduce((count, summary) => count + summary.attention.length, 0)
  const failing = () => props.summaries.some((summary) => summary.attention.some((item) => item.tone === "danger"))
  const tiles = (): Tile[] => [
    {
      filter: "attention",
      label: "Needs attention",
      icon: "warning",
      value: attentionItems(),
      tone: failing() ? "danger" : "warning",
      projects: props.summaries.filter((summary) => summary.attention.length > 0).length,
    },
    {
      filter: "running",
      label: "Running",
      icon: "activity",
      value: props.summaries.filter((summary) => summary.status === "in_progress").length,
      tone: "info",
      projects: props.summaries.filter((summary) => summary.status === "in_progress").length,
    },
    {
      filter: "all",
      label: "Sessions",
      icon: "session",
      value: props.summaries.reduce((count, summary) => count + summary.sessionCount, 0),
      tone: "neutral",
      projects: props.summaries.length,
    },
    {
      filter: "terminal",
      label: "Claude Code",
      icon: "terminal",
      value: props.summaries.reduce((count, summary) => count + summary.terminalSessionCount, 0),
      tone: "special",
      projects: props.summaries.filter((summary) => summary.terminalSessionCount > 0).length,
    },
  ]

  return (
    <section class="project-directory-summary" aria-label="Project summary">
      <For each={tiles()}>
        {(tile) => (
          <Button
            appearance="ghost"
            class="project-summary-item"
            data-metric={tile.tone}
            aria-pressed={props.filter === tile.filter}
            disabled={tile.projects === 0 && tile.filter !== "all"}
            title={tileHint(tile, props.filter)}
            onClick={() => props.setFilter(props.filter === tile.filter ? "all" : tile.filter)}
          >
            <span class="project-summary-label">
              <Icon name={tile.icon} />
              {tile.label}
            </span>
            <strong>{tile.value}</strong>
            <Show when={tile.filter === "running" && tile.value > 0}>
              <span class="mini-spinner" aria-hidden="true" />
            </Show>
          </Button>
        )}
      </For>
    </section>
  )
}

function tileHint(tile: Tile, active: ProjectOverviewFilter) {
  if (tile.filter === "all") return `${tile.value} sessions across every project`
  if (tile.projects === 0) return `No projects are ${tile.label.toLowerCase()}`
  if (active === tile.filter) return "Show every project"
  return `Show the ${tile.projects} ${tile.projects === 1 ? "project" : "projects"} this counts`
}
