/**
 * The catalog carries thousands of models across ~170 providers. Expanding every
 * match on search rebuilt the whole list on each keystroke, so search reveals the
 * strongest sections eagerly and leaves the long tail one click away.
 */
export const AUTO_EXPANDED_SECTIONS = 8
export const SECTION_PREVIEW_LIMIT = 12

/**
 * An explicit toggle always wins. Auto-expansion is only the default for a
 * section the reader has not touched, so collapsing one keeps working while a
 * search is active.
 */
export function providerSectionExpanded(input: { override?: boolean; searching: boolean; index: number }) {
  return input.override ?? (input.searching && input.index < AUTO_EXPANDED_SECTIONS)
}

export function providerSectionLimit(showAll: boolean) {
  return showAll ? Number.POSITIVE_INFINITY : SECTION_PREVIEW_LIMIT
}
