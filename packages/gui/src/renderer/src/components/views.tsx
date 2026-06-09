import type { JSX } from "solid-js"
import type { OpencodeXView } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import type { ViewItem } from "../lib/view-items"

type LayoutNode = number | { direction: "row" | "column"; children: LayoutNode[] }

export function ViewsPage(props: {
  view?: OpencodeXView
  items: ViewItem[]
  renderItem: (item: ViewItem) => JSX.Element
}) {
  const layout = createMemo(() => viewLayout(props.items.length))
  return (
    <div class="page views-page">
      <Show when={props.view} fallback={<Empty text="Create a view to work across multiple sessions." />}>
        <Show when={props.items.length > 0} fallback={<Empty text="This view has no available sessions." />}>
          {renderViewLayout({ node: layout(), items: props.items, renderItem: props.renderItem })}
        </Show>
      </Show>
    </div>
  )
}

function viewLayout(count: number): LayoutNode {
  if (count <= 1) return 0
  if (count === 2) return { direction: "row", children: [0, 1] }
  if (count === 3) return { direction: "row", children: [0, { direction: "column", children: [1, 2] }] }
  if (count === 4) return { direction: "column", children: [{ direction: "row", children: [0, 1] }, { direction: "row", children: [2, 3] }] }
  if (count === 5) return { direction: "row", children: [{ direction: "column", children: [0, 1, 2] }, { direction: "column", children: [3, 4] }] }
  if (count === 6) return { direction: "column", children: [{ direction: "row", children: [0, 1, 2] }, { direction: "row", children: [3, 4, 5] }] }
  if (count === 7) return { direction: "row", children: [{ direction: "column", children: [0, 1, 2, 3] }, { direction: "column", children: [4, 5, 6] }] }
  return { direction: "column", children: [{ direction: "row", children: [0, 1, 2, 3] }, { direction: "row", children: [4, 5, 6, 7] }] }
}

function renderViewLayout(input: { node: LayoutNode; items: ViewItem[]; renderItem: (item: ViewItem) => JSX.Element }): JSX.Element {
  if (typeof input.node === "number") {
    const item = input.items[input.node]
    if (!item) return <></>
    return input.renderItem(item)
  }
  return (
    <div class={`view-layout-group ${input.node.direction}`}>
      <For each={input.node.children}>{(node) => renderViewLayout({ ...input, node })}</For>
    </div>
  )
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
