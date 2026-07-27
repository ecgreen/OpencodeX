import { For, createSignal } from "solid-js"
import {
  Button,
  CountBadge,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  ProgressMeter,
  Skeleton,
  StatusBadge,
  SurfaceCard,
  useToast,
  type ToastTone,
} from "../ui"
import { RouteLoadingSkeleton } from "../route-loading"
import { Grid, Row, Section, Specimen } from "./lab-shared"
import styles from "./lab.module.css"

const APPEARANCES = ["soft", "outline", "solid", "bare"] as const
const TOAST_TONES: ToastTone[] = ["success", "info", "warning", "danger"]

export function LabFeedback() {
  const toast = useToast()
  const [progress, setProgress] = createSignal(0.42)

  return (
    <>
      <Section title="Status badges" detail="Tone, glyph, and default label all resolve from lib/status-system.">
        <Grid columns={4}>
          <For each={APPEARANCES}>
            {(appearance) => (
              <Specimen label={appearance}>
                <StatusBadge status="running" appearance={appearance} />
                <StatusBadge status="ready_for_review" appearance={appearance} />
                <StatusBadge status="failed" appearance={appearance} />
              </Specimen>
            )}
          </For>
        </Grid>
      </Section>

      <Section title="Counts" detail="Counters never change the geometry of the element that hosts them.">
        <Row>
          <CountBadge count={3} />
          <CountBadge count={12} tone="info" />
          <CountBadge count={128} tone="danger" />
          <CountBadge count={7} tone="accent" />
        </Row>
      </Section>

      <Section title="Notices" detail="Inline notices explain a condition in place. Danger notices announce as alerts.">
        <Grid columns={2}>
          <InlineNotice tone="info" title="Runner connected">Windows runner · 2 available slots</InlineNotice>
          <InlineNotice tone="success" title="Applied cleanly">12 files changed, tests passing.</InlineNotice>
          <InlineNotice tone="warning" title="Review required">Three changed files have not been validated.</InlineNotice>
          <InlineNotice tone="danger" title="Browser unavailable">The native view was detached after a renderer restart.</InlineNotice>
        </Grid>
      </Section>

      <Section title="System states" detail="One clear explanation and at most one primary recovery action.">
        <Grid columns={3}>
          <SurfaceCard><LoadingState compact title="Loading workspace tools" description="Restoring files, Git, terminal, and browser state." /></SurfaceCard>
          <SurfaceCard><EmptyState compact title="No review items" description="Completed agent work that needs attention appears here." actionLabel="Start a session" /></SurfaceCard>
          <SurfaceCard><ErrorState compact title="Browser connection lost" description="The last address is retained while the view reconnects." actionLabel="Retry now" /></SurfaceCard>
        </Grid>
      </Section>

      <Section title="Skeletons" detail="Use where the final geometry is known. Calmer and more honest than a spinner.">
        <Grid columns={2}>
          <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-2)" }}>
            <Skeleton shape="title" width="45%" />
            <Skeleton lines={3} />
          </div>
          <div class={styles.panel} style={{ display: "grid", "grid-template-columns": "auto minmax(0, 1fr)", gap: "var(--ds-space-3)", "align-items": "start" }}>
            <Skeleton shape="circle" />
            <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
              <Skeleton shape="text" width="60%" />
              <Skeleton shape="block" />
            </div>
          </div>
        </Grid>
      </Section>

      <Section title="Route loading" detail="Shown while a route's lazy chunk loads. The shape matches the route being opened, and the fade-in is delayed so fast navigations show nothing at all.">
        <Grid columns={2}>
          <Specimen label="manager page" wide={false}>
            <div class={styles.panel} style={{ padding: "0", overflow: "hidden", width: "100%" }}>
              <RouteLoadingSkeleton route={{ name: "swarms" }} />
            </div>
          </Specimen>
          <Specimen label="workspace">
            <div class={styles.panel} style={{ padding: "0", overflow: "hidden", width: "100%", height: "260px" }}>
              <RouteLoadingSkeleton route={{ name: "session", sessionID: "demo" }} />
            </div>
          </Specimen>
        </Grid>
      </Section>

      <Section title="Progress" detail="For context windows, token budgets, and swarm completion. Readouts use tabular numerals.">
        <Grid columns={2}>
          <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-4)" }}>
            <ProgressMeter value={progress()} label="Context window" detail={`${Math.round(progress() * 200)}k / 200k`} />
            <ProgressMeter value={0.88} tone="warning" label="Token budget" detail="88%" />
            <ProgressMeter value={0.97} tone="danger" label="Rate limit" detail="97%" />
            <ProgressMeter label="Indexing repository" detail="working" />
          </div>
          <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-3)", "align-content": "start" }}>
            <span class={styles.specimenLabel}>Drive the meter to check the transition.</span>
            <Row>
              <Button appearance="outline" size="compact" onClick={() => setProgress((value) => Math.max(0, value - 0.15))}>Decrease</Button>
              <Button appearance="outline" size="compact" onClick={() => setProgress((value) => Math.min(1, value + 0.15))}>Increase</Button>
            </Row>
          </div>
        </Grid>
      </Section>

      <Section title="Toasts" detail="Report the outcome of async work. Auto-dismiss pauses nothing else on screen.">
        <Row>
          <For each={TOAST_TONES}>
            {(tone) => (
              <Button
                appearance="outline"
                onClick={() =>
                  toast.push({
                    tone,
                    title: `${tone[0].toUpperCase()}${tone.slice(1)} notification`,
                    detail: "Pushed from the component lab.",
                    action: { label: "Undo", onSelect: () => undefined },
                  })
                }
              >
                Push {tone}
              </Button>
            )}
          </For>
          <Button appearance="soft" tone="accent" onClick={() => toast.push({ title: "Persistent toast", detail: "Requires an explicit dismiss.", duration: 0 })}>
            Push persistent
          </Button>
        </Row>
      </Section>
    </>
  )
}
