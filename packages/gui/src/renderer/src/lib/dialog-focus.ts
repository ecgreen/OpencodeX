const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function dialogFocusableElements(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && !element.hidden && element.getAttribute("aria-hidden") !== "true")
}

export function trappedDialogTabTarget(elements: readonly HTMLElement[], active: Element | null, reverse: boolean) {
  if (elements.length === 0) return
  if (!elements.includes(active as HTMLElement)) return reverse ? elements.at(-1) : elements[0]
  if (reverse && active === elements[0]) return elements.at(-1)
  if (!reverse && active === elements.at(-1)) return elements[0]
}

export function restoreDialogFocus(element: HTMLElement | undefined) {
  if (!element?.isConnected) return
  element.focus({ preventScroll: true })
}
