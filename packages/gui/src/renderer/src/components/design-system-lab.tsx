import { For, createEffect, createSignal, onCleanup } from "solid-js"
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  InlineNotice,
  LoadingState,
  SearchField,
  Select,
  SurfaceCard,
  Switch,
  TextArea,
  TextField,
  type ControlAppearance,
  type ControlTone,
} from "./ui"
import styles from "./design-system-lab.module.css"

const appearances: ControlAppearance[] = ["solid", "soft", "outline", "ghost"]
const tones: ControlTone[] = ["neutral", "accent", "danger", "success", "warning", "info"]
const projects = [
  { id: "opencodex", label: "OpencodeX", group: "Active" },
  { id: "runner", label: "Runner infrastructure", group: "Active" },
  { id: "docs", label: "Product documentation", group: "Recent" },
]

export function DesignSystemLab() {
  const query = new URLSearchParams(window.location.search)
  const [theme, setTheme] = createSignal(query.get("theme") === "light" ? "light" : "dark")
  const [project, setProject] = createSignal(projects[0])
  const [queryValue, setQueryValue] = createSignal("")
  const [automaticReview, setAutomaticReview] = createSignal(true)

  const previousTheme = document.documentElement.dataset.theme
  createEffect(() => {
    document.documentElement.dataset.theme = theme()
  })
  onCleanup(() => {
    if (previousTheme) {
      document.documentElement.dataset.theme = previousTheme
      return
    }
    delete document.documentElement.dataset.theme
  })

  return (
    <main class={styles.lab} data-theme={theme()}>
      <header class={styles.header}>
        <div>
          <span class={styles.eyebrow}>Approved direction · Instrument-grade</span>
          <h1>GUI design system lab</h1>
          <p>Canonical primitives and system states rendered against realistic ADE density.</p>
        </div>
        <div class={styles.headerActions}>
          <Button appearance="outline" selected={theme() === "dark"} onClick={() => setTheme("dark")}>Dark</Button>
          <Button appearance="outline" selected={theme() === "light"} onClick={() => setTheme("light")}>Light</Button>
        </div>
      </header>

      <section class={styles.section} aria-labelledby="lab-buttons">
        <SectionHeader id="lab-buttons" title="Buttons" detail="Appearance and tone are independent semantic axes." />
        <div class={styles.buttonMatrix}>
          <For each={appearances}>
            {(appearance) => (
              <SurfaceCard class={styles.matrixRow}>
                <code>{appearance}</code>
                <div>
                  <For each={tones}>{(tone) => <Button appearance={appearance} tone={tone}>{tone}</Button>}</For>
                </div>
              </SurfaceCard>
            )}
          </For>
        </div>
        <div class={styles.inlineRow}>
          <Button appearance="solid" tone="accent" size="prominent">New session</Button>
          <Button appearance="outline" leadingIcon="folder">Open project</Button>
          <Button appearance="soft" tone="danger">Cancel run</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <IconButton appearance="ghost" icon="settings" label="Session settings" />
        </div>
      </section>

      <section class={styles.section} aria-labelledby="lab-fields">
        <SectionHeader id="lab-fields" title="Fields and selection" detail="Labels, messages, and progress reserve stable geometry." />
        <div class={styles.fieldGrid}>
          <TextField label="Task title" value="Audit native browser lifecycle" />
          <SearchField label="Search sessions" value={queryValue()} onInput={(event) => setQueryValue(event.currentTarget.value)} clearable onClear={() => setQueryValue("")} />
          <TextField label="Repository path" value="C:\\Work\\OpencodeX" technical readOnly description="Runner-visible workspace mapping" />
          <TextField label="Branch" value="" error="A branch is required" required />
          <Select<(typeof projects)[number]> label="Project" options={projects} current={project()} optionValue={(item) => item.id} optionLabel={(item) => item.label} groupBy={(item) => item.group} onSelect={(value) => value && setProject(value)} />
          <TextField label="Provider" value="Discovering local providers" loading />
          <TextArea class={styles.fullSpan} label="Agent instructions" value="Preserve transcript scrolling and validate the browser view lifecycle." />
        </div>
      </section>

      <section class={styles.section} aria-labelledby="lab-controls">
        <SectionHeader id="lab-controls" title="Controls and feedback" detail="Shared accessible behavior, instrument-grade presentation." />
        <div class={styles.controlGrid}>
          <SurfaceCard class={styles.controlCard}>
            <Checkbox label="Create an isolated worktree" description="Recommended for substantial agent changes" defaultChecked />
            <Switch checked={automaticReview()} onChange={setAutomaticReview}>Require review before apply</Switch>
          </SurfaceCard>
          <div class={styles.noticeStack}>
            <InlineNotice tone="info" title="Runner connected">Windows runner · 2 available slots</InlineNotice>
            <InlineNotice tone="warning" title="Review required">Three changed files have not been validated.</InlineNotice>
            <InlineNotice tone="danger" title="Browser unavailable">The native view was detached after a renderer restart.</InlineNotice>
          </div>
        </div>
      </section>

      <section class={styles.section} aria-labelledby="lab-states">
        <SectionHeader id="lab-states" title="System states" detail="One clear explanation and one recovery action." />
        <div class={styles.stateGrid}>
          <SurfaceCard><LoadingState compact title="Loading workspace tools" description="Restoring files, Git, terminal, and browser state." /></SurfaceCard>
          <SurfaceCard><EmptyState compact title="No review items" description="Completed agent work that needs attention will appear here." actionLabel="Start a session" /></SurfaceCard>
          <SurfaceCard><ErrorState compact title="Browser connection lost" description="The last address is retained while the native view reconnects." actionLabel="Retry now" /></SurfaceCard>
        </div>
      </section>
    </main>
  )
}

function SectionHeader(props: { id: string; title: string; detail: string }) {
  return <header class={styles.sectionHeader}><div><span>FOUNDATION</span><h2 id={props.id}>{props.title}</h2></div><p>{props.detail}</p></header>
}
