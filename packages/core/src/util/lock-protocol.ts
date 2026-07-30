import path from "path"
import { randomBytes, randomUUID } from "crypto"
import { Hash } from "./hash"

/**
 * The on-disk contract for the advisory file lock, shared by both
 * implementations (`Flock`, promise-based, and `EffectFlock`).
 *
 * Both wrap this module rather than restating the layout, so a lock taken by
 * one is honoured — and correctly detected as stale — by the other. Change the
 * layout here and both sides move together; never inline these values.
 *
 * Layout, for a lock keyed `k` under directory `d`:
 *
 *     d/<hash(k)>.lock/           the lock itself; `mkdir` is the atomic primitive
 *     d/<hash(k)>.lock/meta.json  owner record (see `Meta`) written with flag "wx"
 *     d/<hash(k)>.lock/heartbeat  mtime refreshed by the owner while it holds
 *     d/<hash(k)>.lock.breaker/   short-lived; elects one contender to evict a stale lock
 */
export namespace LockProtocol {
  /** Directory mode for the lock dir and the breaker dir. */
  export const DIR_MODE = 0o700

  export const ROOT_DIR = "locks"
  export const LOCK_SUFFIX = ".lock"
  export const BREAKER_SUFFIX = ".breaker"
  export const META_FILE = "meta.json"
  export const HEARTBEAT_FILE = "heartbeat"

  /** A lock whose heartbeat/meta/dir mtime is older than this may be evicted. */
  export const STALE_MS = 60_000
  /** Total time a contender waits before giving up. */
  export const TIMEOUT_MS = 5 * 60_000
  export const BASE_DELAY_MS = 100
  export const MAX_DELAY_MS = 2_000
  export const BACKOFF_FACTOR = 1.7

  /** Refresh interval that keeps a held lock comfortably inside `STALE_MS`. */
  export function heartbeatIntervalMs(staleMs: number = STALE_MS) {
    return Math.max(100, Math.floor(staleMs / 3))
  }

  /** The lock root under a `Global.state` directory. */
  export function rootDir(stateDir: string) {
    return path.join(stateDir, ROOT_DIR)
  }

  /** The lock directory for `key`, inside `dir`. */
  export function lockDir(dir: string, key: string) {
    return path.join(dir, Hash.fast(key) + LOCK_SUFFIX)
  }

  export function metaPath(lockDir: string) {
    return path.join(lockDir, META_FILE)
  }

  export function heartbeatPath(lockDir: string) {
    return path.join(lockDir, HEARTBEAT_FILE)
  }

  export function breakerPath(lockDir: string) {
    return lockDir + BREAKER_SUFFIX
  }

  /** Opaque ownership token; compared verbatim on release. */
  export function createToken() {
    return randomUUID?.() ?? randomBytes(16).toString("hex")
  }

  /** The contents of `meta.json`. Both implementations read and write this shape. */
  export type Meta = {
    token: string
    pid: number
    hostname: string
    createdAt: string
  }

  export function meta(input: { token: string; hostname: string }): Meta {
    return {
      token: input.token,
      pid: process.pid,
      hostname: input.hostname,
      createdAt: new Date().toISOString(),
    }
  }
}
