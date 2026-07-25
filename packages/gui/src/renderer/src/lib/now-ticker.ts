import { createSignal, onCleanup } from "solid-js"

const [now, setNow] = createSignal(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
let subscribers = 0

function subscribe() {
  subscribers += 1
  if (timer !== undefined) return
  timer = setInterval(() => setNow(Date.now()), 1000)
}

function release() {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0 || timer === undefined) return
  clearInterval(timer)
  timer = undefined
}

/**
 * A single shared one-second clock. Elapsed timers are per tool call and a
 * long turn has dozens of them, so they must not each own an interval.
 */
export function useNowTicker() {
  subscribe()
  onCleanup(release)
  return now
}

export function nowTickerSubscriberCount() {
  return subscribers
}
