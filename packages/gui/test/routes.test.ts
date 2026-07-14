import { describe, expect, test } from "bun:test"
import { routeLayoutMode, type Route } from "../src/renderer/src/lib/routes"

describe("route layout metadata", () => {
  test.each([
    [{ name: "session", sessionID: "session" }, "full-bleed"],
    [{ name: "new-session" }, "full-bleed"],
    [{ name: "views", viewID: "view" }, "full-bleed"],
    [{ name: "workbench" }, "full-bleed"],
    [{ name: "diff" }, "full-bleed"],
    [{ name: "dashboard" }, "scroll-page"],
    [{ name: "projects" }, "scroll-page"],
    [{ name: "swarms" }, "scroll-page"],
    [{ name: "plugins" }, "scroll-page"],
  ] as const)("maps %o to %s", (route, expected) => {
    expect(routeLayoutMode(route as Route)).toBe(expected)
  })
})
