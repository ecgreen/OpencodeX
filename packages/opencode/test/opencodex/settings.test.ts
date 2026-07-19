import { expect, test } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import path from "path"
import { OpencodeXSettings } from "../../src/opencodex/settings"
import { tmpdir } from "../fixture/fixture"

test("OpenCodeX settings persist separately from the OpenCode config", async () => {
  await using tmp = await tmpdir()
  const config = path.join(tmp.path, "opencode.jsonc")
  const settings = path.join(tmp.path, "opencodex.json")
  const original = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  await Bun.write(config, original)

  const result = await Effect.runPromise(
    OpencodeXSettings.Service.use((service) => service.update({ permission_mode: "yolo" })).pipe(
      Effect.provide(OpencodeXSettings.layer(settings)),
      Effect.provide(AppFileSystem.defaultLayer),
    ),
  )

  expect(result.permission_mode).toBe("yolo")
  expect(await Bun.file(settings).json()).toEqual({ permission_mode: "yolo" })
  expect(await Bun.file(config).text()).toBe(original)
})
