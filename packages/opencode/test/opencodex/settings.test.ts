import { expect, test } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Effect, Exit, Layer } from "effect"
import path from "path"
import { OpencodeXSettings } from "../../src/opencodex/settings"
import { tmpdir } from "../fixture/fixture"

const settingsLayer = (file: string) =>
  OpencodeXSettings.layer(file).pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(EffectFlock.defaultLayer),
  )

test("OpenCodeX settings persist separately from the OpenCode config", async () => {
  await using tmp = await tmpdir()
  const config = path.join(tmp.path, "opencode.jsonc")
  const settings = path.join(tmp.path, "opencodex.json")
  const original = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  await Bun.write(config, original)

  const result = await Effect.runPromise(
    OpencodeXSettings.Service.use((service) =>
      Effect.gen(function* () {
        const current = yield* service.get()
        return yield* service.update({ permission_mode: "yolo", expectedRevision: current.revision })
      }),
    ).pipe(Effect.provide(settingsLayer(settings))),
  )

  expect(result.permission_mode).toBe("yolo")
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/)
  expect(await Bun.file(settings).json()).toEqual({ permission_mode: "yolo" })
  expect(await Bun.file(config).text()).toBe(original)
})

test("OpenCodeX settings reject stale replacement and preserve unknown fields", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "opencodex.json")
  await Bun.write(file, JSON.stringify({ future: { enabled: true } }))

  const outcomes = await Effect.runPromise(
    OpencodeXSettings.Service.use((service) =>
      Effect.gen(function* () {
        const current = yield* service.get()
        return yield* Effect.all(
          [
            service.update({ permission_mode: "strict", expectedRevision: current.revision }).pipe(Effect.exit),
            service.update({ permission_mode: "auto", expectedRevision: current.revision }).pipe(Effect.exit),
          ],
          { concurrency: "unbounded" },
        )
      }),
    ).pipe(Effect.provide(settingsLayer(file))),
  )

  expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1)
  expect(outcomes.filter(Exit.isFailure)).toHaveLength(1)
  expect(await Bun.file(file).json()).toMatchObject({ future: { enabled: true } })
})

test("OpenCodeX settings do not overwrite malformed JSON", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "opencodex.json")
  const malformed = "{ invalid"
  await Bun.write(file, malformed)

  const exit = await Effect.runPromiseExit(
    OpencodeXSettings.Service.use((service) =>
      service.update({ permission_mode: "strict", expectedRevision: "stale" }),
    ).pipe(Effect.provide(settingsLayer(file))),
  )

  expect(String(exit)).toContain("OpencodeX.Settings.InvalidSettingsError")
  expect(await Bun.file(file).text()).toBe(malformed)
})
