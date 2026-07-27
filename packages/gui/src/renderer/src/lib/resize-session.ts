export function createResizeSession<T>(initial: T, input: {
  preview: (value: T) => void
  persist: (value: T) => void
}) {
  let current = initial
  let active = true

  return {
    update(value: T) {
      if (!active) return
      current = value
      input.preview(value)
    },
    finish() {
      if (!active) return
      active = false
      input.persist(current)
    },
  }
}
