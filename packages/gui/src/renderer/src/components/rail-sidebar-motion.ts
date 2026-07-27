export function animateLayoutRows(selector: string, previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const key = element.dataset.railProjectRowId
    if (!key) continue
    const animations = element.getAnimations()
    const animatedRect = enabled && animations.length > 0 ? element.getBoundingClientRect() : undefined
    animations.forEach((animation) => animation.cancel())
    const rect = element.getBoundingClientRect()
    next.set(key, rect)
    const before = animatedRect ?? previous.get(key)
    if (!enabled || !before) continue
    const deltaY = before.top - rect.top
    if (Math.abs(deltaY) < 1) continue
    element.animate([
      { transform: `translateY(${deltaY}px)` },
      { transform: "translateY(0)" },
    ], {
      duration: 220,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    })
  }
  return next
}
