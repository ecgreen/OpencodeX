import type { Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import { formatRelative } from "../lib/format"
import type { SessionData } from "../lib/store"
import { defaultTeamRun, type SwarmTeamRun, type SwarmTeamView } from "../lib/swarm-team"
import { Icon } from "./icon"
import type { SessionPageProps } from "./session-page-types"
import { TranscriptPanel } from "./session-transcript-panel"
import { Button, Select } from "./ui"

const EMPTY_MEMBER_DATA: SessionData = { messages: [], todos: [], diffs: [] }

/** The session page's team view: strip always, member pane while toggled in. */
export function SessionSwarmTeam(props: { page: SessionPageProps }) {
  return (
    <>
      <Show when={props.page.team}>
        {(team) => (
          <SwarmTeamStrip
            team={team()}
            selectedSessionID={props.page.teamMemberSessionID ?? ""}
            select={(sessionID) => props.page.selectTeamMember?.(sessionID)}
          />
        )}
      </Show>
      <Show when={props.page.team && props.page.teamMemberSessionID ? props.page.team : undefined}>
        {(team) => (
          <SwarmMemberPane
            team={team()}
            sessionID={props.page.teamMemberSessionID!}
            data={props.page.teamMemberData}
            loading={props.page.teamMemberLoading === true}
            providers={props.page.providers}
            showTimestamps={props.page.showTimestamps}
            showThinking={props.page.showThinking}
            showToolDetails={props.page.showToolDetails}
            showScrollbar={props.page.showScrollbar}
            showGenericToolOutput={props.page.showGenericToolOutput}
            concealCodeBlocks={props.page.concealCodeBlocks === true}
            select={(sessionID) => props.page.selectTeamMember?.(sessionID)}
          />
        )}
      </Show>
    </>
  )
}

/**
 * The swarm session's team bar. The user always talks to the orchestrator;
 * these chips toggle a read-only view into each specialist's child sessions.
 */
export function SwarmTeamStrip(props: {
  team: SwarmTeamView
  selectedSessionID: string
  select: (sessionID: string) => void
}) {
  return (
    <nav class="swarm-team-strip" aria-label={`${props.team.title} team`}>
      <Button
        appearance="ghost"
        class="swarm-team-chip orchestrator"
        classList={{ selected: !props.selectedSessionID }}
        onClick={() => props.select("")}
      >
        <Icon name="swarm" />
        <span>Orchestrator</span>
      </Button>
      <For each={props.team.members}>
        {(member) => (
          <Button
            appearance="ghost"
            class="swarm-team-chip"
            classList={{
              selected: member.runs.some((run) => run.id === props.selectedSessionID),
              busy: member.busy,
            }}
            disabled={member.runs.length === 0}
            title={member.runs.length === 0 ? `${member.name} has not been delegated to yet` : member.description}
            onClick={() => {
              const run = defaultTeamRun(member)
              if (run) props.select(run.id)
            }}
          >
            <span class="swarm-team-chip-dot" aria-hidden="true" />
            <span>{member.name}</span>
            <Show when={member.runs.length > 1}>
              <small>{member.runs.length}</small>
            </Show>
          </Button>
        )}
      </For>
    </nav>
  )
}

/** A specialist's transcript, shown in place of the orchestrator's. */
export function SwarmMemberPane(props: {
  team: SwarmTeamView
  sessionID: string
  data?: SessionData
  loading: boolean
  providers: Provider[]
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  concealCodeBlocks: boolean
  select: (sessionID: string) => void
}) {
  const member = createMemo(() => props.team.members.find((item) => item.runs.some((run) => run.id === props.sessionID)))
  const run = createMemo(() => member()?.runs.find((item) => item.id === props.sessionID))
  return (
    <section class="swarm-member-pane">
      <header class="swarm-member-header">
        <div class="swarm-member-heading">
          <strong>{member()?.name ?? "Team member"}</strong>
          <span>{run()?.busy ? "Working..." : run() ? `Updated ${formatRelative(run()!.updated)}` : ""}</span>
        </div>
        <Show when={(member()?.runs.length ?? 0) > 1}>
          <Select<SwarmTeamRun>
            size="compact"
            class="swarm-member-run-select"
            options={member()!.runs}
            current={run()}
            optionValue={(item) => item.id}
            optionLabel={(item) => `${item.title} · ${formatRelative(item.updated)}`}
            onSelect={(item) => item && props.select(item.id)}
          />
        </Show>
        <Button appearance="outline" size="compact" icon="x" onClick={() => props.select("")}>
          Back to orchestrator
        </Button>
      </header>
      <TranscriptPanel
        sessionID={props.sessionID}
        data={props.data ?? EMPTY_MEMBER_DATA}
        loading={props.loading}
        providers={props.providers}
        showTimestamps={props.showTimestamps}
        showThinking={props.showThinking}
        showToolDetails={props.showToolDetails}
        showScrollbar={props.showScrollbar}
        showGenericToolOutput={props.showGenericToolOutput}
        concealCodeBlocks={props.concealCodeBlocks}
        running={run()?.busy === true}
        emptyStateDismissed
      />
      <footer class="swarm-member-note">
        <span>Read-only view - steer this specialist by messaging the orchestrator.</span>
      </footer>
    </section>
  )
}
