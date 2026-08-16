import { expect, test } from "bun:test"
import path from "node:path"

test("renderer meta CSP permits the configured backend schemes", async () => {
  const html = await Bun.file(path.join(import.meta.dir, "../src/renderer/index.html")).text()

  expect(html).toContain("connect-src 'self' http: https: ws: wss: data:")
})
