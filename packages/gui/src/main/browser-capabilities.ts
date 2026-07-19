export const BROWSER_SNAPSHOT_MAX_BYTES = 64_000
export const BROWSER_SNAPSHOT_MAX_ITEMS = 200

export type BrowserSnapshotItem = {
  tag: string
  role?: string
  label?: string
  name?: string
  text?: string
  href?: string
  value?: string
  type?: string
  disabled?: boolean
  checked?: boolean
}

export type BrowserSnapshot = {
  url: string
  title: string
  bodyText: string
  items: BrowserSnapshotItem[]
}

export function validExternalBrowserURL(value: unknown) {
  if (typeof value !== "string" || !URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  return url.toString()
}

export function shapeBrowserSnapshot(value: unknown): BrowserSnapshot | undefined {
  if (!isRecord(value)) return undefined
  const url = boundedLine(value.url, 2_048)
  const title = boundedLine(value.title, 500)
  const bodyText = fitBodyText(url, title, boundedBodyText(value.bodyText, 24_000))
  const base = { url, title, bodyText }
  const candidates = Array.isArray(value.items)
    ? value.items
        .slice(0, BROWSER_SNAPSHOT_MAX_ITEMS)
        .map(shapeBrowserSnapshotItem)
        .filter((item): item is BrowserSnapshotItem => item !== undefined)
    : []
  const items = candidates.reduce<BrowserSnapshotItem[]>((result, item) => {
    const next = [...result, item]
    if (snapshotBytes({ ...base, items: next }) > BROWSER_SNAPSHOT_MAX_BYTES) return result
    return next
  }, [])
  return { ...base, items }
}

function shapeBrowserSnapshotItem(value: unknown): BrowserSnapshotItem | undefined {
  if (!isRecord(value)) return undefined
  const tag = boundedLine(value.tag, 32).toLowerCase()
  if (!tag) return undefined
  const role = optionalLine(value.role, 100)
  const label = optionalLine(value.label, 500)
  const name = optionalLine(value.name, 500)
  const text = optionalLine(value.text, 500)
  const href = optionalLine(value.href, 2_048)
  const type = optionalLine(value.type, 100)
  const valueText = type?.toLowerCase() === "password" ? "[REDACTED]" : optionalLine(value.value, 1_000)
  const disabled = typeof value.disabled === "boolean" ? value.disabled : undefined
  const checked = typeof value.checked === "boolean" ? value.checked : undefined
  return {
    tag,
    ...(role ? { role } : {}),
    ...(label ? { label } : {}),
    ...(name ? { name } : {}),
    ...(text ? { text } : {}),
    ...(href ? { href } : {}),
    ...(valueText ? { value: valueText } : {}),
    ...(type ? { type } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
    ...(checked !== undefined ? { checked } : {}),
  }
}

function fitBodyText(url: string, title: string, value: string) {
  if (snapshotBytes({ url, title, bodyText: value, items: [] }) <= BROWSER_SNAPSHOT_MAX_BYTES) return value
  const characters = Array.from(value)
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const bodyText = characters.slice(0, middle).join("")
    if (snapshotBytes({ url, title, bodyText, items: [] }) <= BROWSER_SNAPSHOT_MAX_BYTES) low = middle
    else high = middle - 1
  }
  return characters.slice(0, low).join("")
}

function boundedLine(value: unknown, limit: number) {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, limit)
}

function optionalLine(value: unknown, limit: number) {
  return boundedLine(value, limit) || undefined
}

function boundedBodyText(value: unknown, limit: number) {
  if (typeof value !== "string") return ""
  return value
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit)
}

function snapshotBytes(value: BrowserSnapshot) {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
