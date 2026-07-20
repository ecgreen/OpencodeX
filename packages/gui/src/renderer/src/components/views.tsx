import type { Accessor, JSX } from "solid-js"
import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { For, Show, createMemo } from "solid-js"
import { viewItemID, viewItemsMembershipKey, type ViewItem } from "../lib/view-items"

export type LayoutNode = number | { direction: "row" | "column"; children: LayoutNode[] }

export function ViewsPage(props: {
  view?: ClientCatalogView
  items: ViewItem[]
  renderItem: (item: Accessor<ViewItem>) => JSX.Element
}) {
  const membershipKey = createMemo(() => viewItemsMembershipKey(props.view?.id, props.items))
  const itemIDs = createMemo(() => membershipKey().split("\n").slice(1))
  const itemsByID = createMemo(() => new Map(props.items.map((item) => [viewItemID(item), item])))
  const layout = createMemo(() => viewLayout(itemIDs().length))
  const layoutSize = createMemo(() => viewLayoutDimensions(layout()))
  return (
    <div
      class="page views-page"
      data-pane-density={viewDensity(props.items.length)}
      style={{
        "--view-layout-min-width": `${layoutSize().columns * 260 + (layoutSize().columns - 1) * 8}px`,
        "--view-layout-min-height": `${layoutSize().rows * 220 + (layoutSize().rows - 1) * 8}px`,
      }}
    >
      <Show when={props.view} fallback={<Empty text="Create a view to work across multiple sessions." />}>
        <Show when={props.items.length > 0} fallback={<Empty text="This view has no available sessions." />}>
          {renderViewLayout({ node: layout(), itemIDs: itemIDs(), itemsByID, renderItem: props.renderItem })}
        </Show>
      </Show>
    </div>
  )
}

export function viewDensity(count: number) {
  return count > 1 ? "compact" : "comfortable"
}

export function viewLayoutDimensions(node: LayoutNode): { columns: number; rows: number } {
  if (typeof node === "number") return { columns: 1, rows: 1 }
  const children = node.children.map(viewLayoutDimensions)
  if (node.direction === "row") {
    return {
      columns: children.reduce((total, child) => total + child.columns, 0),
      rows: Math.max(...children.map((child) => child.rows)),
    }
  }
  return {
    columns: Math.max(...children.map((child) => child.columns)),
    rows: children.reduce((total, child) => total + child.rows, 0),
  }
}

export function viewLayout(count: number): LayoutNode {
  if (count <= 1) return 0
  if (count === 2) return { direction: "row", children: [0, 1] }
  if (count === 3) return { direction: "row", children: [0, { direction: "column", children: [1, 2] }] }
  if (count === 4) return { direction: "column", children: [{ direction: "row", children: [0, 1] }, { direction: "row", children: [2, 3] }] }
  if (count === 5) return { direction: "row", children: [{ direction: "column", children: [0, 1, 2] }, { direction: "column", children: [3, 4] }] }
  if (count === 6) return { direction: "column", children: [{ direction: "row", children: [0, 1, 2] }, { direction: "row", children: [3, 4, 5] }] }
  if (count === 7) return { direction: "row", children: [{ direction: "column", children: [0, 1, 2, 3] }, { direction: "column", children: [4, 5, 6] }] }
  return { direction: "column", children: [{ direction: "row", children: [0, 1, 2, 3] }, { direction: "row", children: [4, 5, 6, 7] }] }
}

function renderViewLayout(input: { node: LayoutNode; itemIDs: string[]; itemsByID: Accessor<Map<string, ViewItem>>; renderItem: (item: Accessor<ViewItem>) => JSX.Element }): JSX.Element {
  if (typeof input.node === "number") {
    const id = input.itemIDs[input.node]
    if (!id) return <></>
    return (
      <Show keyed when={id}>
        {(paneID) => <ViewPaneSlot item={() => input.itemsByID().get(paneID)} renderItem={input.renderItem} />}
      </Show>
    )
  }
  return (
    <div class={`view-layout-group ${input.node.direction}`}>
      <For each={input.node.children}>{(node) => renderViewLayout({ ...input, node })}</For>
    </div>
  )
}

function ViewPaneSlot(props: { item: Accessor<ViewItem | undefined>; renderItem: (item: Accessor<ViewItem>) => JSX.Element }) {
  return (
    <Show when={props.item()}>
      {(item) => props.renderItem(item)}
    </Show>
  )
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
