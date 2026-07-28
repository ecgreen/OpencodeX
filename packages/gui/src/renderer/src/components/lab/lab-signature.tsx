import { For, createSignal } from "solid-js"
import { knownStatuses, knownVariants, statusPresentation } from "../../lib/status-system"
import { OpencodeXLogo } from "../opencodex-logo"
import { AgentGlyph, IconButton, ModelBadge, SessionCard, StatusBadge } from "../ui"
import { Grid, Row, Section, Specimen } from "./lab-shared"
import styles from "./lab.module.css"

const SESSIONS = [
  {
    title: "Audit native browser lifecycle",
    status: "in_progress",
    model: "claude-fable-5", provider: "anthropic", variant: "build",
    project: "OpencodeX",
    meta: [{ label: "Elapsed", value: "4m 12s" }, { label: "Tokens", value: "84.2k" }, { label: "Cost", value: "$0.94" }],
  },
  {
    title: "Recover swarm coordinator state after restart",
    status: "input_needed",
    model: "gpt-5.5", provider: "openai", variant: "plan",
    project: "Runner infrastructure",
    meta: [{ label: "Waiting", value: "1m 30s" }, { label: "Tokens", value: "12.8k" }],
  },
  {
    title: "Port upstream diff viewer to the workbench",
    status: "ready_for_review",
    model: "minimax-m3-free", provider: "opencode zen",
    project: "OpencodeX",
    meta: [{ label: "Files", value: "12" }, { label: "Tokens", value: "203k" }, { label: "Cost", value: "$1.86" }],
  },
  {
    title: "Migrate release pipeline to signed artifacts",
    status: "failed",
    model: "deepseek-v4-flash", provider: "deepseek",
    project: "MiniCode",
    meta: [{ label: "Failed", value: "2h ago" }],
  },
]

const AGENTS = ["build", "plan", "review", "general purpose", "claude-fable-5", "gpt-5.5", "swarm coordinator", "docs writer"]

export function LabSignature() {
  const [selected, setSelected] = createSignal(SESSIONS[0].title)

  const actions = (
    <>
      <IconButton appearance="ghost" size="compact" icon="pin" label="Pin session" tooltip="Pin session" />
      <IconButton appearance="ghost" size="compact" icon="more" label="Session actions" tooltip="Session actions" />
    </>
  )

  return (
    <>
      <Section title="Wordmark" detail="The animated ASCII wordmark. Light mode: dark gray letters, light gray interior shading, orange X.">
        <div data-lab-logo style={{ padding: "16px", background: "var(--theme-canvas)", "border-radius": "8px", width: "max-content" }}>
          <OpencodeXLogo />
        </div>
      </Section>

      <Section title="Session card · dashboard density" detail="The atom of the product. Left stripe and badge both encode status, so it reads in grayscale.">
        <Grid columns={2}>
          <For each={SESSIONS}>
            {(session) => (
              <SessionCard
                {...session}
                density="card"
                selected={selected() === session.title}
                onOpen={() => setSelected(session.title)}
                actions={actions}
              />
            )}
          </For>
        </Grid>
      </Section>

      <Section title="Session card · list density" detail="Same anatomy, tighter. Used by the sessions list and collection pages.">
        <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
          <For each={SESSIONS}>
            {(session) => (
              <SessionCard
                {...session}
                density="row"
                selected={selected() === session.title}
                onOpen={() => setSelected(session.title)}
                actions={actions}
              />
            )}
          </For>
        </div>
      </Section>

      <Section title="Session card · rail density" detail="Sidebar rows drop the glyph and the metric strip, keeping the status stripe.">
        <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-0)", "max-width": "300px" }}>
          <For each={SESSIONS}>
            {(session) => (
              <SessionCard
                title={session.title}
                status={session.status}
                model={session.model}
                density="rail"
                selected={selected() === session.title}
                onOpen={() => setSelected(session.title)}
              />
            )}
          </For>
        </div>
      </Section>

      <Section title="Status system" detail="One table maps every state to a tone, a glyph, and a label. Color is never the only signal.">
        <div class={styles.panel}>
          <table class={styles.tokens}>
            <thead>
              <tr><th>Status</th><th>Tone</th><th>Badge</th></tr>
            </thead>
            <tbody>
              <For each={knownStatuses()}>
                {(status) => (
                  <tr>
                    <td><code>{status}</code></td>
                    <td>{statusPresentation(status).tone}</td>
                    <td><StatusBadge status={status} /></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Identity" detail="A deterministic glyph and color per agent, model, or role. The same name always reads the same.">
        <Grid columns={4}>
          <For each={AGENTS}>
            {(name) => (
              <Specimen label={name}>
                <AgentGlyph name={name} size="compact" />
                <AgentGlyph name={name} />
                <AgentGlyph name={name} size="prominent" />
              </Specimen>
            )}
          </For>
        </Grid>
      </Section>

      <Section title="Model badges" detail="One provider, model, and variant grammar for the composer, cards, and pickers.">
        <Row>
          <ModelBadge model="claude-fable-5" provider="anthropic" variant="build" />
          <ModelBadge model="gpt-5.5" provider="openai" />
          <ModelBadge model="minimax-m3-free" provider="opencode zen" variant="plan" />
          <ModelBadge model="qwen3-coder:30b" provider="ollama" />
        </Row>
      </Section>

      <Section title="Agent modes" detail="Mode colors match the TUI's mode chips, so a mode reads the same in both clients.">
        <Row>
          <For each={knownVariants()}>
            {(variant) => <ModelBadge model="claude-fable-5" variant={variant} />}
          </For>
        </Row>
      </Section>
    </>
  )
}
