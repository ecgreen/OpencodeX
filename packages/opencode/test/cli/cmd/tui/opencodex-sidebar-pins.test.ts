import { describe, expect, test } from "bun:test"
import { pinnedSidebarItems } from "../../../../src/cli/cmd/tui/component/opencodex-sidebar-pins"

describe("opencodex sidebar pins", () => {
  test("resolves items in pin order and ignores missing items", () => {
    const items = [
      { id: "first", title: "First" },
      { id: "second", title: "Second" },
    ]

    expect(pinnedSidebarItems(["second", "missing", "first"], items)).toEqual([items[1], items[0]])
  })
})
