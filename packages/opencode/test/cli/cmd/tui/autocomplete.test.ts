import { describe, expect, test } from "bun:test"
import {
  extractAutocompleteLineRange,
  removeAutocompleteLineRange,
} from "@/cli/cmd/tui/component/prompt/autocomplete-types"

describe("prompt autocomplete line ranges", () => {
  test("keeps ordinary mention searches unchanged", () => {
    expect(extractAutocompleteLineRange("src/server")).toEqual({ baseQuery: "src/server" })
    expect(removeAutocompleteLineRange("src/server")).toBe("src/server")
  })

  test("extracts single-line and bounded ranges", () => {
    expect(extractAutocompleteLineRange("src/server.ts#12")).toEqual({
      baseQuery: "src/server.ts",
      lineRange: { baseName: "src/server.ts", startLine: 12, endLine: undefined },
    })
    expect(extractAutocompleteLineRange("src/server.ts#12-18")).toEqual({
      baseQuery: "src/server.ts",
      lineRange: { baseName: "src/server.ts", startLine: 12, endLine: 18 },
    })
    expect(removeAutocompleteLineRange("src/server.ts#12-18")).toBe("src/server.ts")
  })

  test("does not create a backwards end range", () => {
    expect(extractAutocompleteLineRange("src/server.ts#18-12")).toEqual({
      baseQuery: "src/server.ts",
      lineRange: { baseName: "src/server.ts", startLine: 18, endLine: undefined },
    })
  })
})
