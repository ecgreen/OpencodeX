export function validString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
