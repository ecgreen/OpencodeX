import { For } from "solid-js"
import { Grid, Section, TokenTable } from "./lab-shared"
import styles from "./lab.module.css"

const TYPE_RAMP = [
  { token: "2xl", size: "28 / 34", role: "Hero moments only: onboarding, splash, empty states." },
  { token: "xl", size: "20 / 28", role: "Page titles on manager pages." },
  { token: "lg", size: "17 / 24", role: "Section, dialog, and panel titles." },
  { token: "md", size: "15 / 22", role: "Reading prose: transcript markdown, descriptions." },
  { token: "base", size: "14 / 20", role: "Default UI text. Buttons, inputs, menus, cards." },
  { token: "sm", size: "13 / 18", role: "Secondary content, dense lists, field labels." },
  { token: "xs", size: "12 / 16", role: "Meta rows, timestamps, captions, table headers." },
  { token: "2xs", size: "11 / 15", role: "Micro labels and badges. Uppercase at this size only." },
]

const WEIGHTS = [
  { token: "regular", value: "400", role: "Body and reading text" },
  { token: "medium", value: "500", role: "Emphasized body, list titles, menu items" },
  { token: "semibold", value: "620", role: "Controls, field labels, tabs, badges" },
  { token: "bold", value: "700", role: "Section, dialog, and page titles" },
  { token: "display", value: "800", role: "Hero and brand moments only" },
]

const SPACE = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
const SURFACES = ["canvas", "surface", "surface-raised", "surface-hover", "surface-selected"]
const SEMANTIC = ["control-accent", "danger", "warning", "success", "info", "special", "text", "text-muted", "text-subtle"]

export function LabFoundations() {
  return (
    <>
      <Section title="Type ramp" detail="Eight sizes, each paired with a line height. Nothing outside this ramp ships.">
        <div class={styles.panel}>
          <For each={TYPE_RAMP}>
            {(entry) => (
              <div style={{ "border-bottom": "1px solid var(--ds-border-subtle)", padding: "var(--ds-space-3) 0" }}>
                <div style={{ "font-size": `var(--ds-text-${entry.token})`, "line-height": `var(--ds-leading-${entry.token})` }}>
                  Supervising software agents
                </div>
                <div style={{ display: "flex", gap: "var(--ds-space-3)", "margin-top": "var(--ds-space-1)" }}>
                  <code class={styles.specimenLabel}>--ds-text-{entry.token}</code>
                  <span class={styles.specimenLabel}>{entry.size}</span>
                  <span class={styles.specimenLabel}>{entry.role}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Weight ramp" detail="Geist is variable. Five sanctioned weights replace the 23 raw values the codebase grew.">
        <div class={styles.panel}>
          <For each={WEIGHTS}>
            {(entry) => (
              <div style={{ display: "flex", "align-items": "baseline", gap: "var(--ds-space-4)", padding: "var(--ds-space-2) 0" }}>
                <span style={{ "font-weight": `var(--ds-weight-${entry.token})`, "min-width": "220px" }}>Instrument-grade</span>
                <code class={styles.specimenLabel}>--ds-weight-{entry.token}</code>
                <span class={styles.specimenLabel}>{entry.value}</span>
                <span class={styles.specimenLabel}>{entry.role}</span>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Spacing" detail="A 4px grid. --ds-space-0 is the single sub-grid step, reserved for hairline gaps.">
        <div class={styles.panel}>
          <For each={SPACE}>
            {(step) => (
              <div style={{ display: "flex", "align-items": "center", gap: "var(--ds-space-4)", padding: "var(--ds-space-1) 0" }}>
                <code class={styles.specimenLabel} style={{ "min-width": "120px" }}>--ds-space-{step}</code>
                <div class={styles.spaceBar} style={{ width: `calc(var(--ds-space-${step}) * 6)` }} />
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section title="Surface ladder" detail="Four steps, one tonal notch apart. Features never invent a fifth background.">
        <Grid columns={5}>
          <For each={SURFACES}>
            {(name) => (
              <div class={styles.swatch}>
                <div class={styles.swatchChip} style={{ background: `var(--ds-${name})` }} />
                <span class={styles.swatchName}>{name}</span>
              </div>
            )}
          </For>
        </Grid>
      </Section>

      <Section title="Semantic color" detail="Components consume these only. Raw color values live in the theme sheets.">
        <Grid columns={5}>
          <For each={SEMANTIC}>
            {(name) => (
              <div class={styles.swatch}>
                <div class={styles.swatchChip} style={{ background: `var(--ds-${name})` }} />
                <span class={styles.swatchName}>{name}</span>
              </div>
            )}
          </For>
        </Grid>
      </Section>

      <Section title="Shape and elevation" detail="Attached surfaces separate by tone and hairline border. Shadow means detached.">
        <Grid columns={4}>
          <div class={styles.swatch}>
            <div class={styles.elevationTile} style={{ "border-radius": "var(--ds-radius-control)" }}>control 6px</div>
          </div>
          <div class={styles.swatch}>
            <div class={styles.elevationTile} style={{ "border-radius": "var(--ds-radius-card)" }}>card 8px</div>
          </div>
          <div class={styles.swatch}>
            <div class={styles.elevationTile} style={{ "border-radius": "var(--ds-radius-overlay)", "box-shadow": "var(--ds-elevation-overlay)" }}>overlay</div>
          </div>
          <div class={styles.swatch}>
            <div class={styles.elevationTile} style={{ "border-radius": "var(--ds-radius-overlay)", "box-shadow": "var(--ds-elevation-modal)" }}>modal</div>
          </div>
        </Grid>
      </Section>

      <Section title="Motion" detail="Transforms and opacity only. Reduced motion collapses every duration to 1ms.">
        <TokenTable
          rows={[
            { token: "--ds-motion-hover", value: "120ms", sample: "Hover and press feedback" },
            { token: "--ds-motion-control", value: "160ms", sample: "Control state changes" },
            { token: "--ds-motion-route", value: "220ms", sample: "Panels and route transitions" },
            { token: "--ds-ease-enter", value: "cubic-bezier(0.16, 1, 0.3, 1)", sample: "Entrances" },
            { token: "--ds-ease-smooth", value: "cubic-bezier(0.45, 0, 0.25, 1)", sample: "Size changes" },
          ]}
        />
      </Section>
    </>
  )
}
