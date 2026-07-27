const WORD_STARTS = new Set([" ", "-", "_", "/", ":", "(", ".", "@"])

// Scores a query against text: exact substrings outrank subsequence matches,
// earlier and tighter matches outrank later and looser ones. Returns
// undefined when the query does not match at all.
export function fuzzyScore(query: string, text: string): number | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const haystack = text.toLowerCase()
  if (!haystack) return
  const substringAt = haystack.indexOf(needle)
  if (substringAt >= 0) return Math.max(100, 1000 - substringAt * 10) - Math.min(haystack.length - needle.length, 50)
  let score = 0
  let lastMatch = -2
  let at = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, at)
    if (found < 0) return
    score += 1
    if (found === lastMatch + 1) score += 6
    if (found === 0 || WORD_STARTS.has(haystack.charAt(found - 1))) score += 4
    lastMatch = found
    at = found + 1
  }
  return score
}

export function bestFuzzyScore(query: string, texts: readonly (string | undefined)[]): number | undefined {
  let best: number | undefined
  for (const text of texts) {
    if (!text) continue
    const score = fuzzyScore(query, text)
    if (score === undefined) continue
    if (best === undefined || score > best) best = score
  }
  return best
}

export function rankByScore<T>(query: string, items: readonly T[], texts: (item: T) => readonly (string | undefined)[]): T[] {
  return items
    .flatMap((item) => {
      const score = bestFuzzyScore(query, texts(item))
      return score === undefined ? [] : [{ item, score }]
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item)
}
