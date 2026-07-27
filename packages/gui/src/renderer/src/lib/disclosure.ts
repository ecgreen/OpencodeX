import { createEffect, createMemo, createSignal, untrack } from "solid-js"

export type DisclosureStore = {
  get(id: string): boolean | undefined
  set(id: string, open: boolean): void
  delete(id: string): void
  readonly size: number
}

export type DisclosureOptions = {
  /** Stable identity for the row, normally the part ULID. */
  id: () => string
  /** State-derived default: open while the work is live or failed. */
  auto: () => boolean
  /** False when the reader has scrolled away from the bottom. */
  following?: () => boolean
  store?: () => DisclosureStore | undefined
}

/**
 * Disclosure state is computed from the part's own status, until the reader
 * says otherwise. An explicit toggle is remembered for the session and always
 * outranks the automatic value, so the transcript never re-collapses something
 * somebody deliberately opened.
 */
export function createDisclosure(options: DisclosureOptions) {
  const store = () => options.store?.()
  const override = createMemo(() => store()?.get(options.id()))
  const open = createMemo(() => {
    const explicit = override()
    if (explicit !== undefined) return explicit
    return options.auto()
  })

  // Collapsing content above the viewport would yank the page under a reader,
  // so when they are not following the tail we latch the row open instead.
  const latchIfScrolledAway = () => {
    if (options.following === undefined || untrack(options.following)) return
    if (untrack(override) !== undefined || untrack(options.auto)) return
    store()?.set(untrack(options.id), true)
  }

  // Watch only the automatic value: the latch matters at the moment work
  // finishes, not every time the reader scrolls.
  let wasOpen = untrack(options.auto)
  createEffect(() => {
    const next = options.auto()
    const closing = wasOpen && !next
    wasOpen = next
    if (closing) latchIfScrolledAway()
  })

  const handleToggle = (event: { currentTarget: { open: boolean } }) => {
    const next = event.currentTarget.open
    // `toggle` also fires when we change `open` reactively. Only a value that
    // disagrees with what we asked for can have come from the user.
    if (next === open()) return
    store()?.set(options.id(), next)
  }

  return { open, handleToggle, latchIfScrolledAway }
}

/**
 * A plain Map would not re-render on write - Solid cannot see a mutation - so
 * reads are tracked through a version signal that every write bumps.
 */
export function createDisclosureStore(): DisclosureStore {
  const [version, setVersion] = createSignal(0)
  const values = new Map<string, boolean>()
  const bump = () => setVersion((value) => value + 1)
  return {
    get(id) {
      version()
      return values.get(id)
    },
    set(id, open) {
      if (values.get(id) === open) return
      values.set(id, open)
      bump()
    },
    delete(id) {
      if (!values.delete(id)) return
      bump()
    },
    get size() {
      version()
      return values.size
    },
  }
}

const STORES = new Map<string, DisclosureStore>()
const STORE_LIMIT = 24

/**
 * One override map per session, kept in memory only: part ids are ULIDs that
 * never repeat, and after a restart the status-derived defaults are the right
 * answer anyway.
 */
export function sessionDisclosureStore(sessionID: string) {
  const existing = STORES.get(sessionID)
  if (existing) {
    STORES.delete(sessionID)
    STORES.set(sessionID, existing)
    return existing
  }
  const store = createDisclosureStore()
  STORES.set(sessionID, store)
  while (STORES.size > STORE_LIMIT) {
    const oldest = STORES.keys().next()
    if (oldest.done) break
    STORES.delete(oldest.value)
  }
  return store
}

export function clearSessionDisclosureStore(sessionID: string) {
  STORES.delete(sessionID)
}

/**
 * True once the disclosure has been open at all. Bodies gate on this instead of
 * on `open()` directly: rows that were never expanded stay unmounted (the perf
 * defense for long transcripts), but collapsing keeps the content in the DOM so
 * the close animation has something to shrink over.
 */
export function createMountedOnce(open: () => boolean) {
  return createMemo<boolean>((prev) => prev || open(), untrack(open))
}

/** Auto-open rule shared by tool rows and tool groups. */
export function autoOpenForStatus(status: string, alwaysOpenWhenComplete = false) {
  if (status === "running" || status === "pending" || status === "error") return true
  return alwaysOpenWhenComplete
}
