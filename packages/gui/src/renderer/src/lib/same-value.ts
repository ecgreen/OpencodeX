export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
  if (!isRecord(left) || !isRecord(right)) return false
  const prototype = Object.getPrototypeOf(left)
  if (prototype !== Object.getPrototypeOf(right) || (prototype !== Object.prototype && prototype !== null)) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
