import { Button } from "./ui"
import { For, type Accessor, type Setter } from "solid-js"
import type { WorkbenchTab } from "../lib/workbench"
import { Icon } from "./icon"

const WORKBENCH_TABS = [
  { id: "files", label: "Files", icon: "folder" },
  { id: "git", label: "Git", icon: "branch" },
  { id: "browser", label: "Browser", icon: "browser" },
  { id: "artifacts", label: "Artifacts", icon: "panel" },
] as const

export function WorkbenchTabs(props: {
  tab: Accessor<WorkbenchTab>
  setTab: Setter<WorkbenchTab>
}) {
  return (
    <nav class="workbench-tabs" aria-label="Workbench tabs">
      <For each={WORKBENCH_TABS}>
        {(item) => (
          <Button appearance="ghost" type="button" classList={{ active: props.tab() === item.id }} onClick={() => props.setTab(item.id)}>
            <Icon name={item.icon} /> {item.label}
          </Button>
        )}
      </For>
    </nav>
  )
}
