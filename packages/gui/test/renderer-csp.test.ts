import { expect, test } from "bun:test"
import path from "node:path"

test("renderer does not ship a broad static connection policy", async () => {
  const html = await Bun.file(path.join(import.meta.dir, "../src/renderer/index.html")).text()

  expect(html).not.toContain("http: https: ws: wss:")
  expect(html).not.toContain("Content-Security-Policy")
})

test("Electron and Vite policies add only the configured exact origin", async () => {
  const main = await Bun.file(path.join(import.meta.dir, "../src/main/index.ts")).text()
  const vite = await Bun.file(path.join(import.meta.dir, "../vite.config.mjs")).text()

  expect(main).toContain("configuredBackendConnectSource(loadConfiguredBackend())")
  expect(main).not.toContain("const configuredBackend = configuredBackendConnection()")
  expect(main).toContain("return failedGuiConnection(error)")
  expect(vite).toContain("new URL(process.env.VITE_OPENCODEX_SERVER_URL).origin")
  expect(main).not.toContain('"http:", "https:", "ws:", "wss:"')
  expect(vite).not.toContain('"http:", "https:", "ws:", "wss:"')
})
