import type { JSX } from "solid-js"
import { For } from "solid-js"
import styles from "./lab.module.css"

export type LabPageId = "foundations" | "controls" | "feedback" | "navigation" | "overlays" | "safety" | "signature" | "transcript" | "workspace"

export const LAB_PAGES: { id: LabPageId; label: string; detail: string }[] = [
  { id: "foundations", label: "Foundations", detail: "Type ramp, spacing, color, elevation, motion." },
  { id: "controls", label: "Controls", detail: "Buttons, fields, selection, toggles." },
  { id: "feedback", label: "Feedback", detail: "Badges, notices, states, skeletons, meters, toasts." },
  { id: "navigation", label: "Navigation", detail: "Tabs, shortcuts, command rows, breadcrumbs." },
  { id: "overlays", label: "Overlays", detail: "Tooltips, dialogs, popovers, menus." },
  { id: "safety", label: "Safety", detail: "Permission and question cards, the composer dock queue." },
  { id: "signature", label: "Signature", detail: "Session cards, identity, the status system." },
  { id: "transcript", label: "Transcript", detail: "Message parts at minimum width - no horizontal scroll allowed." },
  { id: "workspace", label: "Workspace", detail: "Side panel tab bar - responsive overflow, tab anatomy." },
]

/** A titled block within a lab page. */
export function Section(props: { title: string; detail?: string; children: JSX.Element }) {
  return (
    <section class={styles.section}>
      <header class={styles.sectionHeader}>
        <h2>{props.title}</h2>
        {props.detail ? <p>{props.detail}</p> : null}
      </header>
      {props.children}
    </section>
  )
}

/** Horizontal wrap of specimens, for variant matrices. */
export function Row(props: { children: JSX.Element; align?: "start" | "center" | "end" }) {
  return <div class={styles.row} data-align={props.align ?? "center"}>{props.children}</div>
}

/** Labels a single specimen so the variant name is always visible. */
export function Specimen(props: { label: string; children: JSX.Element; wide?: boolean }) {
  return (
    <div class={styles.specimen} data-wide={props.wide ? "true" : undefined}>
      <div class={styles.specimenStage}>{props.children}</div>
      <code class={styles.specimenLabel}>{props.label}</code>
    </div>
  )
}

/** Grid of specimens with a fixed column count. */
export function Grid(props: { children: JSX.Element; columns?: number }) {
  return <div class={styles.grid} style={{ "--lab-columns": String(props.columns ?? 3) }}>{props.children}</div>
}

/** Renders a token table so values stay inspectable next to their rendering. */
export function TokenTable(props: { rows: { token: string; value: string; sample?: JSX.Element }[] }) {
  return (
    <table class={styles.tokens}>
      <thead>
        <tr><th>Token</th><th>Value</th><th>Sample</th></tr>
      </thead>
      <tbody>
        <For each={props.rows}>
          {(row) => (
            <tr>
              <td><code>{row.token}</code></td>
              <td class="ds-tabular">{row.value}</td>
              <td>{row.sample}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )
}
