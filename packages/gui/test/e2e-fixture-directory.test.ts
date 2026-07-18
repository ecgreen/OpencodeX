import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fixtureDirectory } from "../e2e/fixture-directory"

test("GUI E2E uses a runner-created absolute directory", async () => {
  expect(path.isAbsolute(fixtureDirectory)).toBeTrue()
  expect((await stat(fixtureDirectory)).isDirectory()).toBeTrue()
  expect(fixtureDirectory.replaceAll("\\", "/")).not.toBe("C:/Work/OpencodeX")
})
