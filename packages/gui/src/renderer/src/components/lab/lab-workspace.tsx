import { For, createSignal } from "solid-js"
import type { OpenTab } from "../session-side-open-types"
import { openTabDefaults } from "../session-side-open-state"
import { createSessionSideTabBarController } from "../session-side-tab-bar-controller"
import { SessionSideTabBar } from "../session-side-tab-bar"
import { Section } from "./lab-shared"
import styles from "./lab.module.css"

/**
 * The side-panel tab bar against mock tabs, at several fixed widths plus a
 * resizable stage. Tabs must stretch to fill each row, collapse into the
 * overflow chip as width shrinks, and come back out as it grows.
 */

function mockTabs(): OpenTab[] {
  const specs: Array<Partial<OpenTab>> = [
    { kind: "git", title: "Git" },
    { kind: "file", title: "session-page.tsx", path: "src/components/session-page.tsx" },
    { kind: "file", title: "claude-driver.ts", path: "src/opencodex/claude-driver.ts" },
    { kind: "terminal", title: "Terminal" },
    { kind: "web", title: "docs.anthropic.com", url: "https://docs.anthropic.com" },
    { kind: "file", title: "safety-present.ts", path: "src/lib/safety-present.ts" },
    { kind: "context", title: "Context" },
    { kind: "file", title: "transcript-scroll.ts", path: "src/lib/transcript-scroll.ts" },
  ]
  return specs.map((spec, index) => ({ ...openTabDefaults(`lab_tab_${index}`), ...spec }))
}

function TabBarStage(props: { width?: number }) {
  const [tabs, setTabs] = createSignal<OpenTab[]>(mockTabs())
  const [activeID, setActiveID] = createSignal("lab_tab_0")
  const controller = createSessionSideTabBarController({
    tabs,
    setTabs,
    activeID,
    activeTab: () => tabs().find((tab) => tab.id === activeID()),
    setActiveID,
    closeTab: (id) => setTabs((current) => current.filter((tab) => tab.id !== id)),
    hideWebTabs: () => {},
    parkBrowser: () => {},
    setMenuOpen: () => {},
  })
  const noop = () => {}
  return (
    <div
      class={styles.workspaceStage}
      style={props.width ? { width: `${props.width}px` } : { resize: "horizontal", overflow: "hidden", "min-width": "320px" }}
    >
      <code class={styles.specimenLabel}>{props.width ? `${props.width}px` : "drag the corner to resize"}</code>
      <SessionSideTabBar controller={controller} addGit={noop} addFile={noop} addTerminal={noop} addContext={noop} addWeb={noop} changedFiles={[]} />
    </div>
  )
}

export function LabWorkspace() {
  return (
    <Section
      title="Side panel tab bar"
      detail="Eight mock tabs. Tabs left-align their icon and label, keep square bottom corners, stretch to fill the row, and overflow into the chip based on measured width - resize the last stage to watch tabs collapse and return."
    >
      <div class={styles.workspaceStages}>
        <For each={[860, 620, 420]}>{(width) => <TabBarStage width={width} />}</For>
        <TabBarStage />
      </div>
    </Section>
  )
}
