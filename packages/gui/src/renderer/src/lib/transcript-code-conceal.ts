export function syncConcealedCodeControls(root: HTMLElement | undefined, conceal: boolean) {
  root?.querySelectorAll<HTMLElement>('[data-component="markdown-code"]').forEach((wrapper) => {
    if (conceal && !wrapper.hasAttribute("data-revealed")) {
      wrapper.tabIndex = 0
      wrapper.setAttribute("role", "button")
      wrapper.setAttribute("aria-label", "Reveal concealed code block")
      return
    }
    wrapper.removeAttribute("tabindex")
    wrapper.removeAttribute("role")
    wrapper.removeAttribute("aria-label")
  })
}

export function revealConcealedCode(root: HTMLElement | undefined, wrapper: Element, conceal: boolean) {
  wrapper.setAttribute("data-revealed", "true")
  syncConcealedCodeControls(root, conceal)
}
