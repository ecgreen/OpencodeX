export type DeferredTimer = {
  schedule: (run: () => void, delay: number) => unknown
  cancel: (handle: unknown) => void
}

const timeoutTimer: DeferredTimer = {
  schedule: (run, delay) => setTimeout(run, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createDebouncedTask<T>(run: (value: T) => void, delay: number, timer = timeoutTimer) {
  let handle: unknown
  let value: T
  let pending = false

  function cancel() {
    if (pending) timer.cancel(handle)
    pending = false
  }

  function flush() {
    if (!pending) return
    timer.cancel(handle)
    pending = false
    run(value)
  }

  return {
    schedule(next: T) {
      if (pending) timer.cancel(handle)
      value = next
      pending = true
      handle = timer.schedule(() => {
        pending = false
        run(value)
      }, delay)
    },
    flush,
    cancel,
    pending: () => pending,
  }
}

export type AnimationFrameTimer = {
  request: (run: () => void) => unknown
  cancel: (handle: unknown) => void
}

const animationFrameTimer: AnimationFrameTimer = {
  request: (run) => requestAnimationFrame(run),
  cancel: (handle) => cancelAnimationFrame(handle as number),
}

export function createAnimationFrameTask(run: () => void, timer = animationFrameTimer) {
  let handle: unknown
  let pending = false
  let generation = 0

  return {
    schedule() {
      if (pending) return
      pending = true
      const current = ++generation
      handle = timer.request(() => {
        run()
        queueMicrotask(() => {
          if (current !== generation) return
          pending = false
        })
      })
    },
    cancel() {
      if (pending) timer.cancel(handle)
      generation++
      pending = false
    },
    pending: () => pending,
  }
}
