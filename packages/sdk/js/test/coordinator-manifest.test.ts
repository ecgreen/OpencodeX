import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  COORDINATOR_MANIFEST_VERSION,
  checkCoordinatorCompatibility,
  coordinatorClientDir,
  coordinatorDatabaseIdentity,
  coordinatorKey,
  coordinatorManifestPath,
  fetchCoordinatorHealth,
  isCoordinatorHealthForManifest,
  isCoordinatorManifest,
  readCoordinatorManifest,
  removeCoordinatorManifest,
  startCoordinatorClientLease,
  writeCoordinatorManifest,
  type CoordinatorManifest,
} from "../src/coordinator/manifest"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function stateRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencodex-coordinator-"))
  roots.push(root)
  return root
}

function manifest(overrides: Partial<CoordinatorManifest> = {}): CoordinatorManifest {
  return {
    version: COORDINATOR_MANIFEST_VERSION,
    key: "abc123",
    directory: "/work/project",
    database: "/data/opencode.db",
    pid: process.pid,
    url: "http://127.0.0.1:4096/",
    username: "opencodex-local",
    password: "password",
    token: "token",
    createdAt: new Date(0).toISOString(),
    serverVersion: "1.2.3",
    ...overrides,
  }
}

describe("coordinator manifest validation", () => {
  test("round-trips a manifest through disk", async () => {
    const root = await stateRoot()
    const written = manifest()
    await writeCoordinatorManifest(root, written)
    expect(await readCoordinatorManifest(root, written.key)).toEqual(written)
    const stat = await fs.stat(coordinatorManifestPath(root, written.key))
    expect(stat.isFile()).toBe(true)
  })

  test("accepts a manifest with no serverVersion so old writers stay readable", () => {
    const { serverVersion: _dropped, ...legacy } = manifest()
    expect(isCoordinatorManifest(legacy)).toBe(true)
  })

  test("accepts unknown extra fields so additive wire changes do not look corrupt", () => {
    expect(isCoordinatorManifest({ ...manifest(), somethingNewer: { nested: true } })).toBe(true)
  })

  test("rejects a non-loopback url, a wrong schema number, and a mistyped serverVersion", () => {
    expect(isCoordinatorManifest(manifest({ url: "http://example.com/" }))).toBe(false)
    expect(isCoordinatorManifest({ ...manifest(), version: 3 })).toBe(false)
    expect(isCoordinatorManifest({ ...manifest(), serverVersion: 3 })).toBe(false)
    expect(isCoordinatorManifest(manifest({ pid: "1" as unknown as number }))).toBe(false)
  })

  test("readCoordinatorManifest rejects a corrupt file instead of returning it", async () => {
    const root = await stateRoot()
    const file = coordinatorManifestPath(root, "abc123")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "{not json")
    await expect(readCoordinatorManifest(root, "abc123")).rejects.toThrow()
  })
})

describe("coordinator key derivation", () => {
  test("is the sha1 of the resolved database identity", () => {
    const absolute = path.resolve("/data/opencode.db")
    expect(coordinatorDatabaseIdentity(absolute)).toBe(
      process.platform === "win32" ? absolute.toLowerCase() : absolute,
    )
    expect(coordinatorKey(absolute)).toMatch(/^[0-9a-f]{40}$/)
    expect(coordinatorKey(absolute)).toBe(coordinatorKey(absolute.toUpperCase() === absolute ? absolute : absolute))
  })

  test("resolves a relative database against the caller's base", () => {
    expect(coordinatorDatabaseIdentity("opencode.db", path.resolve("/data"))).toBe(
      coordinatorDatabaseIdentity(path.resolve("/data", "opencode.db")),
    )
    expect(coordinatorKey("opencode.db", path.resolve("/data"))).toBe(
      coordinatorKey(path.resolve("/data", "opencode.db")),
    )
  })

  test("passes :memory: through untouched", () => {
    expect(coordinatorDatabaseIdentity(":memory:")).toBe(":memory:")
  })
})

describe("token-guarded removal", () => {
  test("keeps the manifest when the token does not match", async () => {
    const root = await stateRoot()
    const written = manifest()
    await writeCoordinatorManifest(root, written)
    expect(await removeCoordinatorManifest(root, written.key, "other-token")).toBe(false)
    expect(await readCoordinatorManifest(root, written.key)).toEqual(written)
  })

  test("removes the manifest when the token matches", async () => {
    const root = await stateRoot()
    const written = manifest()
    await writeCoordinatorManifest(root, written)
    expect(await removeCoordinatorManifest(root, written.key, written.token)).toBe(true)
    await expect(readCoordinatorManifest(root, written.key)).rejects.toThrow()
  })

  test("is a no-op when there is nothing to remove", async () => {
    const root = await stateRoot()
    expect(await removeCoordinatorManifest(root, "missing", "token")).toBe(false)
  })
})

describe("compatibility policy", () => {
  test("attaches only on an exact version match", () => {
    expect(
      checkCoordinatorCompatibility({
        manifest: { serverVersion: "1.2.3" },
        clientVersion: "1.2.3",
        skip: false,
      }),
    ).toEqual({ compatible: true, reason: "match" })

    const mismatch = checkCoordinatorCompatibility({
      manifest: { serverVersion: "1.2.4" },
      clientVersion: "1.2.3",
      skip: false,
    })
    expect(mismatch.compatible).toBe(false)
    expect(mismatch.reason).toBe("mismatch")
    expect(mismatch.message).toContain("1.2.4")
    expect(mismatch.message).toContain("1.2.3")
  })

  test("refuses a legacy manifest and says why", () => {
    const result = checkCoordinatorCompatibility({
      manifest: {},
      clientVersion: "1.2.3",
      skip: false,
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toBe("legacy")
    expect(result.message).toContain("predates the version handshake")
  })

  test("allows a local build on either side with a warning", () => {
    const coordinatorLocal = checkCoordinatorCompatibility({
      manifest: { serverVersion: "local" },
      clientVersion: "1.2.3",
      skip: false,
    })
    expect(coordinatorLocal.compatible).toBe(true)
    expect(coordinatorLocal.reason).toBe("local")
    expect(coordinatorLocal.message).toBeTruthy()

    expect(
      checkCoordinatorCompatibility({
        manifest: { serverVersion: "1.2.3" },
        clientVersion: "local",
        skip: false,
      }).compatible,
    ).toBe(true)
  })

  test("a legacy manifest is not rescued by a local client", () => {
    expect(
      checkCoordinatorCompatibility({ manifest: {}, clientVersion: "local", skip: false }).reason,
    ).toBe("legacy")
  })

  test("cross-checks the manifest against the live health version", () => {
    const stale = checkCoordinatorCompatibility({
      manifest: { serverVersion: "1.2.3" },
      clientVersion: "1.2.3",
      healthVersion: "1.3.0",
      skip: false,
    })
    expect(stale.compatible).toBe(false)
    expect(stale.reason).toBe("health_mismatch")
    expect(stale.message).toContain("stale")

    expect(
      checkCoordinatorCompatibility({
        manifest: { serverVersion: "1.2.3" },
        clientVersion: "1.2.3",
        healthVersion: "1.2.3",
        skip: false,
      }),
    ).toEqual({ compatible: true, reason: "match" })
  })

  test("the skip escape bypasses every refusal", () => {
    expect(
      checkCoordinatorCompatibility({ manifest: {}, clientVersion: "1.2.3", skip: true }),
    ).toEqual({ compatible: true, reason: "skipped" })
    expect(
      checkCoordinatorCompatibility({
        manifest: { serverVersion: "9.9.9" },
        clientVersion: "1.2.3",
        healthVersion: "0.0.1",
        skip: true,
      }).compatible,
    ).toBe(true)
  })

  test("reads the skip escape from the environment by default", () => {
    const previous = process.env.OPENCODEX_SKIP_VERSION_CHECK
    try {
      process.env.OPENCODEX_SKIP_VERSION_CHECK = "1"
      expect(
        checkCoordinatorCompatibility({ manifest: {}, clientVersion: "1.2.3" }).reason,
      ).toBe("skipped")
      delete process.env.OPENCODEX_SKIP_VERSION_CHECK
      expect(checkCoordinatorCompatibility({ manifest: {}, clientVersion: "1.2.3" }).reason).toBe("legacy")
    } finally {
      if (previous === undefined) delete process.env.OPENCODEX_SKIP_VERSION_CHECK
      else process.env.OPENCODEX_SKIP_VERSION_CHECK = previous
    }
  })
})

describe("health probe", () => {
  test("returns the parsed version alongside the health flag", async () => {
    const health = await fetchCoordinatorHealth(manifest(), {
      fetch: async () =>
        new Response(JSON.stringify({ healthy: true, version: "1.2.3", active: false, coordinatorKey: "abc123" }), {
          headers: { "content-type": "application/json" },
        }),
    })
    expect(health).toEqual({ healthy: true, version: "1.2.3", active: false, coordinatorKey: "abc123" })
  })

  test("returns undefined for an unreachable or failing coordinator", async () => {
    expect(
      await fetchCoordinatorHealth(manifest(), {
        fetch: async () => {
          throw new Error("ECONNREFUSED")
        },
      }),
    ).toBeUndefined()
    expect(
      await fetchCoordinatorHealth(manifest(), { fetch: async () => new Response("nope", { status: 500 }) }),
    ).toBeUndefined()
  })

  test("sends the manifest's basic credentials", async () => {
    let authorization: string | undefined
    await fetchCoordinatorHealth(manifest(), {
      fetch: async (_url, init) => {
        authorization = (init?.headers as Record<string, string>).authorization
        return new Response(JSON.stringify({ healthy: true, version: "1.2.3", active: true }))
      },
    })
    expect(authorization).toBe(`Basic ${Buffer.from("opencodex-local:password").toString("base64")}`)
  })

  test("matches health to the manifest database key", () => {
    expect(isCoordinatorHealthForManifest(manifest(), { healthy: true, coordinatorKey: "abc123" })).toBe(true)
    expect(isCoordinatorHealthForManifest(manifest(), { healthy: true, coordinatorKey: "different" })).toBe(false)
    expect(isCoordinatorHealthForManifest(manifest(), { healthy: true })).toBe(false)
  })
})

describe("client lease", () => {
  test("writes, then removes, a lease keyed by pid", async () => {
    const root = await stateRoot()
    const lease = startCoordinatorClientLease({ stateRoot: root, key: "abc123", interval: 60_000 })
    await lease.ready
    const dir = coordinatorClientDir(root, "abc123")
    expect(await fs.readdir(dir)).toEqual([`${process.pid}.json`])
    expect(JSON.parse(await fs.readFile(lease.file, "utf8"))).toMatchObject({
      version: 1,
      key: "abc123",
      pid: process.pid,
    })
    await lease.dispose()
    expect(await fs.readdir(dir)).toEqual([])
  })

  test("applies the caller's suffix so client kinds stay distinguishable", async () => {
    const root = await stateRoot()
    const lease = startCoordinatorClientLease({
      stateRoot: root,
      key: "abc123",
      suffix: ".gui",
      pid: 4242,
      interval: 60_000,
    })
    await lease.ready
    expect(await fs.readdir(coordinatorClientDir(root, "abc123"))).toEqual(["4242.gui.json"])
    await lease.dispose()
  })

  test("dispose is idempotent", async () => {
    const root = await stateRoot()
    const lease = startCoordinatorClientLease({ stateRoot: root, key: "abc123", interval: 60_000 })
    await lease.ready
    await lease.dispose()
    await lease.dispose()
    expect(await fs.readdir(coordinatorClientDir(root, "abc123"))).toEqual([])
  })
})
