import { describe, expect, test } from "bun:test"
import {
  AUTO_EXPANDED_SECTIONS,
  SECTION_PREVIEW_LIMIT,
  providerSectionExpanded,
  providerSectionLimit,
} from "../src/renderer/src/lib/model-picker-sections"

describe("providerSectionExpanded", () => {
  test("stays collapsed while browsing", () => {
    expect(providerSectionExpanded({ searching: false, index: 0 })).toBe(false)
    expect(providerSectionExpanded({ searching: false, index: 40 })).toBe(false)
  })

  test("auto-expands only the leading sections of a search", () => {
    expect(providerSectionExpanded({ searching: true, index: 0 })).toBe(true)
    expect(providerSectionExpanded({ searching: true, index: AUTO_EXPANDED_SECTIONS - 1 })).toBe(true)
    expect(providerSectionExpanded({ searching: true, index: AUTO_EXPANDED_SECTIONS })).toBe(false)
  })

  test("an explicit collapse survives an active search", () => {
    expect(providerSectionExpanded({ override: false, searching: true, index: 0 })).toBe(false)
  })

  test("an explicit expand survives past the auto-expand cutoff", () => {
    expect(providerSectionExpanded({ override: true, searching: true, index: 99 })).toBe(true)
    expect(providerSectionExpanded({ override: true, searching: false, index: 99 })).toBe(true)
  })
})

describe("providerSectionLimit", () => {
  test("caps rendered rows until the section is opened in full", () => {
    expect(providerSectionLimit(false)).toBe(SECTION_PREVIEW_LIMIT)
    expect(providerSectionLimit(true)).toBe(Number.POSITIVE_INFINITY)
  })
})
