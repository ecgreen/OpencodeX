import { coordinatorHeaders, type CoordinatorManifest } from "@opencode-ai/sdk/coordinator"

/**
 * A fetch wrapper that survives the death of the coordinator it talks to.
 *
 * The TUI resolves a coordinator manifest once at startup and then treats its
 * URL and Basic-auth credentials as fixed. When the coordinator dies mid-session
 * (a GUI dev restart is enough - the coordinator used to share that terminal's
 * console group), every fresh request fails with a connection error forever and
 * view panes sit at "No messages yet." even though a healthy replacement
 * coordinator may already be running on a new port with new credentials.
 *
 * This transport re-roots every request onto the *current* manifest's origin
 * and injects the current credentials. When a request fails in a way that looks
 * like coordinator loss - a connection-level error, or a 401 from a replacement
 * coordinator that came back on the same port with a new password - it re-runs
 * the caller's `resolve` (attach to a healthy coordinator or spawn a fresh
 * one), swaps the manifest, and retries the request once. Resolution is
 * single-flight and cools down after a failure so a dead backend does not turn
 * every retry loop into a spawn storm.
 */
export type CoordinatorTransport = {
  fetch: typeof globalThis.fetch
  /** Current coordinator URL; follows the manifest across recoveries. */
  readonly url: string
  /** Current Basic-auth headers; follow the manifest across recoveries. */
  readonly headers: Record<string, string>
  /** Current manifest. */
  readonly manifest: CoordinatorManifest
}

const RECOVERY_COOLDOWN_MS = 1_500

const CONNECTION_ERROR_CODES = new Set([
  // Bun
  "ConnectionRefused",
  "ConnectionClosed",
  "FailedToOpenSocket",
  // Node / undici
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
])

export function isCoordinatorConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("name" in error && error.name === "AbortError") return false
  if ("code" in error && typeof error.code === "string" && CONNECTION_ERROR_CODES.has(error.code)) return true
  if ("cause" in error && error.cause !== error && isCoordinatorConnectionError(error.cause)) return true
  // Bun/undici surface connection failures as a bare TypeError with this
  // message and no recognizable `.code`. Scope the fallback to that shape so
  // it doesn't swallow unrelated errors that merely mention "Unable to connect".
  return (
    error instanceof TypeError &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("Unable to connect")
  )
}

export function createCoordinatorTransport(input: {
  manifest: CoordinatorManifest
  resolve: () => Promise<CoordinatorManifest>
  /** Called whenever recovery lands on a different manifest (new pid/url/credentials). */
  onManifest?: (manifest: CoordinatorManifest) => void
  fetch?: typeof globalThis.fetch
  cooldownMs?: number
  now?: () => number
}): CoordinatorTransport {
  const baseFetch = input.fetch ?? globalThis.fetch
  const now = input.now ?? Date.now
  const cooldownMs = input.cooldownMs ?? RECOVERY_COOLDOWN_MS
  let manifest = input.manifest
  let recovery: Promise<boolean> | undefined
  let cooldownUntil = -Infinity

  function changed(next: CoordinatorManifest) {
    return (
      next.url !== manifest.url ||
      next.username !== manifest.username ||
      next.password !== manifest.password ||
      next.pid !== manifest.pid ||
      next.key !== manifest.key
    )
  }

  /**
   * Re-resolves the coordinator. Returns true when a recovery pass completed
   * (successfully re-resolved), false when skipped by the cooldown. Concurrent
   * callers share one pass. Throws what `resolve` throws.
   */
  function recover(): Promise<boolean> {
    if (recovery) return recovery
    if (now() < cooldownUntil) return Promise.resolve(false)
    const pass = (async () => {
      try {
        const next = await input.resolve()
        if (changed(next)) {
          manifest = next
          input.onManifest?.(next)
        }
        return true
      } catch (error) {
        cooldownUntil = now() + cooldownMs
        throw error
      } finally {
        recovery = undefined
      }
    })()
    recovery = pass
    return pass
  }

  function target(request: Parameters<typeof globalThis.fetch>[0]) {
    const url = new URL(request instanceof Request ? request.url : String(request))
    return new URL(url.pathname + url.search + url.hash, manifest.url)
  }

  async function send(request: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) {
    const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined))
    const auth = coordinatorHeaders(manifest)
    headers.set("authorization", auth.authorization)
    // `send` may run twice (initial attempt, then a retry after coordinator
    // recovery). `new Request(url, request)` disturbs `request`'s body when it
    // has one, so building straight off the caller's Request would leave the
    // retry with an already-used body. Cloning here reads from a fresh copy
    // each time and leaves the original `request` untouched for the next call.
    if (request instanceof Request)
      return baseFetch(new Request(target(request), request.clone()), { ...init, headers })
    return baseFetch(target(request), { ...init, headers })
  }

  const transportFetch: typeof globalThis.fetch = Object.assign(
    async (request: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      try {
        const response = await send(request, init)
        // A replacement coordinator on the same port has new credentials, so
        // its refusal of the old ones marks the manifest as stale.
        if (response.status !== 401) return response
        const recovered = await recover().catch(() => false)
        if (!recovered) return response
        return send(request, init)
      } catch (error) {
        if (init?.signal?.aborted || !isCoordinatorConnectionError(error)) throw error
        const recovered = await recover().catch(() => false)
        if (!recovered) throw error
        return send(request, init)
      }
    },
    { preconnect: baseFetch.preconnect },
  )

  return {
    fetch: transportFetch,
    get url() {
      return manifest.url
    },
    get headers() {
      return { ...coordinatorHeaders(manifest) }
    },
    get manifest() {
      return manifest
    },
  }
}
