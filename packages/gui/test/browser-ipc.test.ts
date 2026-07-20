import { expect, test } from "bun:test"
import path from "node:path"

test("workbench browser views throttle while hidden", async () => {
  const source = await Bun.file(path.join(import.meta.dirname, "../src/main/browser-ipc.ts")).text()
  expect(source).toContain("backgroundThrottling: true")
  expect(source).not.toContain("backgroundThrottling: false")
})
