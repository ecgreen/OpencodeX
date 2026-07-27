import { describe, expect, test } from "bun:test"
import { routeLayoutMode, type Route } from "../src/renderer/src/lib/routes"

const cases = [
  [{ name: "session", sessionID: "session" }, "full-bleed"],
  [{ name: "new-session" }, "full-bleed"],
  [{ name: "views", viewID: "view" }, "full-bleed"],
  [{ name: "diff" }, "full-bleed"],
  [{ name: "dashboard" }, "scroll-page"],
  [{ name: "projects" }, "scroll-page"],
  [{ name: "swarms" }, "scroll-page"],
  [{ name: "plugins" }, "scroll-page"],
  [{ name: "settings" }, "scroll-page"],
] as const satisfies readonly (readonly [Route, "full-bleed" | "scroll-page"])[]

describe("route layout metadata", () => {
  test.each(cases)("maps %o to %s", (route, expected) => {
    expect(routeLayoutMode(route)).toBe(expected)
  })
})
