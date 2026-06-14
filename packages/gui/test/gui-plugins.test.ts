import { describe, expect, test } from "bun:test"
import {
  guiPluginCommands,
  guiPluginSafety,
  guiPluginThemeCss,
  installGuiPlugin,
  parseGuiPluginManifest,
  sampleGuiPlugins,
  serializeGuiPluginManifest,
} from "../src/renderer/src/lib/gui-plugins"

describe("GUI plugin manifests", () => {
  test("parses safe declarative plugins and generates allowlisted theme CSS", () => {
    const parsed = parseGuiPluginManifest(JSON.stringify({
      schema: "opencodex.gui.plugin/v1",
      id: "custom.theme",
      name: "Custom Theme",
      version: "1.0.0",
      permissions: ["theme"],
      contributes: {
        theme: {
          variables: {
            "--primary": "#7aa2f7",
            "--not-real": "url(http://bad)",
            "--panel": "not a safe value;",
          },
        },
      },
    }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.manifest.contributes?.theme?.variables).toEqual({ "--primary": "#7aa2f7" })
    expect(guiPluginThemeCss(installGuiPlugin([], parsed.manifest, "imported"))).toBe(":root{--primary:#7aa2f7;}")
  })

  test("blocks executable-style permissions from GUI plugins", () => {
    const parsed = parseGuiPluginManifest(JSON.stringify({
      schema: "opencodex.gui.plugin/v1",
      id: "danger.plugin",
      name: "Danger",
      version: "1.0.0",
      permissions: ["shell", "filesystem"],
    }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(guiPluginSafety(parsed.manifest).risk).toBe("high")
    expect(guiPluginSafety(parsed.manifest).blocked).toContain("shell permission is not available to GUI plugins yet.")
  })

  test("installs sample command plugins and exposes prompt commands", () => {
    const review = sampleGuiPlugins().find((plugin) => plugin.id === "studio.review-kit")!
    const installed = installGuiPlugin([], review, "sample")

    expect(JSON.parse(serializeGuiPluginManifest(review)).id).toBe("studio.review-kit")
    expect(guiPluginCommands(installed).map((item) => item.command.title)).toEqual([
      "Review current work",
      "Run release preview checklist",
    ])
  })
})
