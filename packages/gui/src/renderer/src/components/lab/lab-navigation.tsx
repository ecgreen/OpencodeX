import { For, createSignal } from "solid-js"
import { CommandRow, Kbd, Separator, Tabs } from "../ui"
import { Grid, Row, Section, Specimen } from "./lab-shared"
import styles from "./lab.module.css"

const PANEL_TABS = [
  { value: "files", label: "Files", icon: "file", count: 12 },
  { value: "git", label: "Git", icon: "branch", count: 3 },
  { value: "terminal", label: "Terminal", icon: "terminal" },
  { value: "browser", label: "Browser", icon: "browser" },
  { value: "locked", label: "Locked", icon: "lock", disabled: true },
]

const SHORTCUTS = ["mod+k", "mod+shift+p", "ctrl+j", "escape", "shift+enter", "alt+left"]

const COMMANDS = [
  { label: "New session", shortcut: "mod+n" },
  { label: "Switch project", shortcut: "mod+p" },
  { label: "Open Git workbench", shortcut: "mod+shift+g" },
  { label: "Toggle sidebar", shortcut: "mod+b" },
]

export function LabNavigation() {
  const [panel, setPanel] = createSignal("files")
  const [scope, setScope] = createSignal("all")

  return (
    <>
      <Section title="Tabs" detail="Underline tabs for panel and page navigation. Arrow keys move selection.">
        <div class={styles.panel}>
          <Tabs items={PANEL_TABS} value={panel()} onChange={setPanel} label="Workspace panel" />
          <p style={{ margin: "var(--ds-space-4) 0 0", color: "var(--ds-text-muted)", "font-size": "var(--ds-text-sm)" }}>
            Selected panel: <strong>{panel()}</strong>
          </p>
        </div>
      </Section>

      <Section title="Segmented" detail="Same engine, exclusive-picker presentation. Use for filters and modes.">
        <div class={styles.panel}>
          <Tabs
            appearance="segmented"
            label="Session scope"
            value={scope()}
            onChange={setScope}
            items={[
              { value: "all", label: "All" },
              { value: "active", label: "Active", count: 4 },
              { value: "review", label: "Review", count: 2 },
            ]}
          />
        </div>
      </Section>

      <Section title="Keyboard shortcuts" detail="One Kbd primitive renders every binding. Modifiers adapt to the platform.">
        <Grid columns={3}>
          <For each={SHORTCUTS}>{(shortcut) => <Specimen label={shortcut}><Kbd keys={shortcut} /></Specimen>}</For>
        </Grid>
      </Section>

      <Section title="Command rows" detail="The row grammar behind the command palette and menu surfaces.">
        <div class={styles.panel} style={{ display: "grid", gap: "var(--ds-space-0)" }}>
          <For each={COMMANDS}>{(command) => <CommandRow shortcut={command.shortcut}>{command.label}</CommandRow>}</For>
        </div>
      </Section>

      <Section title="Separator" detail="Horizontal and vertical rules. Deletes the per-page divider classes.">
        <div class={styles.panel}>
          <Row>
            <span>Left</span>
            <Separator orientation="vertical" />
            <span>Right</span>
          </Row>
          <Separator />
          <p style={{ margin: "var(--ds-space-3) 0 0", color: "var(--ds-text-muted)", "font-size": "var(--ds-text-sm)" }}>
            Below a horizontal separator.
          </p>
        </div>
      </Section>
    </>
  )
}
