import { For, createSignal } from "solid-js"
import {
  Button,
  Checkbox,
  IconButton,
  SearchField,
  SegmentedControl,
  Select,
  Switch,
  TextArea,
  TextField,
  type ControlAppearance,
  type ControlSize,
  type ControlTone,
} from "../ui"
import { Grid, Row, Section, Specimen } from "./lab-shared"
import styles from "./lab.module.css"

const APPEARANCES: ControlAppearance[] = ["solid", "soft", "outline", "ghost"]
const TONES: ControlTone[] = ["neutral", "accent", "danger", "success", "warning", "info"]
const SIZES: ControlSize[] = ["compact", "default", "prominent"]

const PROJECTS = [
  { id: "opencodex", label: "OpencodeX", group: "Active" },
  { id: "runner", label: "Runner infrastructure", group: "Active" },
  { id: "docs", label: "Product documentation", group: "Recent" },
]

export function LabControls() {
  const [project, setProject] = createSignal(PROJECTS[0])
  const [query, setQuery] = createSignal("")
  const [review, setReview] = createSignal(true)
  const [density, setDensity] = createSignal<"comfortable" | "compact">("comfortable")

  return (
    <>
      <Section title="Button matrix" detail="Appearance and tone are independent axes. One solid accent action per region.">
        <div class={styles.panel}>
          <For each={APPEARANCES}>
            {(appearance) => (
              <div style={{ display: "grid", "grid-template-columns": "92px minmax(0, 1fr)", "align-items": "center", gap: "var(--ds-space-3)", padding: "var(--ds-space-2) 0" }}>
                <code class={styles.specimenLabel}>{appearance}</code>
                <Row>
                  <For each={TONES}>{(tone) => <Button appearance={appearance} tone={tone}>{tone}</Button>}</For>
                </Row>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Sizes and states" detail="Loading and validation preserve geometry so nothing around a control moves.">
        <Grid columns={3}>
          <Specimen label="sizes">
            <For each={SIZES}>{(size) => <Button appearance="outline" size={size}>{size}</Button>}</For>
          </Specimen>
          <Specimen label="states">
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button appearance="outline" selected>Selected</Button>
          </Specimen>
          <Specimen label="with icons">
            <Button appearance="outline" leadingIcon="folder">Open project</Button>
            <Button appearance="soft" tone="danger" leadingIcon="stop">Cancel run</Button>
          </Specimen>
          <Specimen label="icon buttons">
            <For each={SIZES}>{(size) => <IconButton appearance="ghost" size={size} icon="settings" label={`Settings ${size}`} />}</For>
          </Specimen>
          <Specimen label="icon button with tooltip">
            <IconButton appearance="outline" icon="terminal" label="Open terminal" tooltip="Open terminal" shortcut="mod+j" />
            <IconButton appearance="outline" icon="branch" label="Git workbench" tooltip="Git workbench" shortcut="mod+shift+g" />
          </Specimen>
          <Specimen label="full width">
            <Button appearance="solid" tone="accent" fullWidth>New session</Button>
          </Specimen>
        </Grid>
      </Section>

      <Section title="Fields" detail="Fields own labels, messages, affixes, and clearing. Message rows reserve stable space.">
        <div style={{ display: "grid", "grid-template-columns": "repeat(3, minmax(0, 1fr))", gap: "var(--ds-space-3) var(--ds-space-4)", "align-items": "start" }}>
          <TextField label="Task title" value="Audit native browser lifecycle" />
          <SearchField label="Search sessions" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} clearable onClear={() => setQuery("")} />
          <TextField label="Repository path" value="C:\\Work\\OpencodeX" technical readOnly description="Runner-visible workspace mapping" />
          <TextField label="Branch" value="" error="A branch is required" required />
          <TextField label="Provider" value="Discovering local providers" loading />
          <Select<(typeof PROJECTS)[number]>
            label="Project"
            options={PROJECTS}
            current={project()}
            optionValue={(item) => item.id}
            optionLabel={(item) => item.label}
            groupBy={(item) => item.group}
            onSelect={(value) => value && setProject(value)}
          />
          <TextField label="Compact" size="compact" value="Dense toolbar field" />
          <TextField label="Disabled" value="Unavailable" disabled />
          <TextArea label="Agent instructions" value="Preserve transcript scrolling and validate the browser view lifecycle." />
        </div>
      </Section>

      <Section title="Selection and toggles" detail="Selection controls and action surfaces are never interchangeable.">
        <Grid columns={2}>
          <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-3)" }}>
            <Checkbox label="Create an isolated worktree" description="Recommended for substantial agent changes" defaultChecked />
            <Checkbox label="Run tests after apply" />
            <Switch checked={review()} onChange={setReview}>Require review before apply</Switch>
          </div>
          <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-3)", "align-content": "start" }}>
            <SegmentedControl
              label="Transcript density"
              value={density()}
              onChange={setDensity}
              items={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
            <span class={styles.specimenLabel}>SegmentedControl is the exclusive value picker.</span>
          </div>
        </Grid>
      </Section>
    </>
  )
}
