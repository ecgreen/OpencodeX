import { logo } from "@/cli/logo"
import { LOGO_GAP, LOGO_NEAR, type LogoShape, type Trace } from "./logo-types"

export type LogoContext = {
  LEFT: number
  FULL: string[]
  SPAN: number
  MAP: ReturnType<typeof mapGlyphs>
  shape: LogoShape
}

export function logoCellKey(x: number, y: number) {
  return `${x},${y}`
}

export function isLitLogoCell(char: string) {
  return char !== " " && char !== "_" && char !== "~" && char !== ","
}

function route(cells: Array<{ x: number; y: number }>) {
  const left = new Map(cells.map((item) => [logoCellKey(item.x, item.y), item]))
  const path: Array<{ x: number; y: number }> = []
  let current = [...left.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0]
  let direction = { x: 1, y: 0 }

  while (current) {
    path.push(current)
    left.delete(logoCellKey(current.x, current.y))
    if (!left.size) return path

    const next = LOGO_NEAR.map(([dx, dy]) => left.get(logoCellKey(current.x + dx, current.y + dy)))
      .filter((item): item is { x: number; y: number } => Boolean(item))
      .sort((a, b) => {
        const ax = a.x - current.x
        const ay = a.y - current.y
        const bx = b.x - current.x
        const by = b.y - current.y
        const adot = ax * direction.x + ay * direction.y
        const bdot = bx * direction.x + by * direction.y
        if (adot !== bdot) return bdot - adot
        return Math.abs(ax) + Math.abs(ay) - (Math.abs(bx) + Math.abs(by))
      })[0]

    if (!next) {
      current = [...left.values()].sort((a, b) => {
        const da = (a.x - current.x) ** 2 + (a.y - current.y) ** 2
        const db = (b.x - current.x) ** 2 + (b.y - current.y) ** 2
        return da - db
      })[0]
      direction = { x: 1, y: 0 }
      continue
    }

    direction = { x: next.x - current.x, y: next.y - current.y }
    current = next
  }
  return path
}

function mapGlyphs(full: string[]) {
  const cells = full.flatMap((line, y) =>
    Array.from(line).flatMap((char, x) => (isLitLogoCell(char) ? [{ x, y }] : [])),
  )
  const all = new Map(cells.map((item) => [logoCellKey(item.x, item.y), item]))
  const seen = new Set<string>()
  const glyph = new Map<string, number>()
  const trace = new Map<string, Trace>()
  const center = new Map<number, { x: number; y: number }>()
  let id = 0

  cells.forEach((item) => {
    const start = logoCellKey(item.x, item.y)
    if (seen.has(start)) return
    const stack = [item]
    const part: Array<{ x: number; y: number }> = []
    seen.add(start)

    while (stack.length) {
      const current = stack.pop()
      if (!current) continue
      part.push(current)
      glyph.set(logoCellKey(current.x, current.y), id)
      LOGO_NEAR.forEach(([dx, dy]) => {
        const next = all.get(logoCellKey(current.x + dx, current.y + dy))
        if (!next) return
        const mark = logoCellKey(next.x, next.y)
        if (seen.has(mark)) return
        seen.add(mark)
        stack.push(next)
      })
    }

    const ordered = route(part)
    ordered.forEach((cell, index) => trace.set(logoCellKey(cell.x, cell.y), { glyph: id, i: index, l: ordered.length }))
    center.set(id, {
      x: part.reduce((sum, cell) => sum + cell.x, 0) / part.length + 0.5,
      y: (part.reduce((sum, cell) => sum + cell.y, 0) / part.length) * 2 + 1,
    })
    id += 1
  })

  return { glyph, trace, center }
}

export function buildLogoContext(shape: LogoShape): LogoContext {
  const full = shape.left.map((line, index) => line + " ".repeat(LOGO_GAP) + shape.right[index])
  return {
    LEFT: shape.left[0]?.length ?? 0,
    FULL: full,
    SPAN: Math.hypot(full[0]?.length ?? 0, full.length * 2) * 0.94,
    MAP: mapGlyphs(full),
    shape,
  }
}

export function selectLogoGlyph(x: number, y: number, context: LogoContext) {
  const direct = context.MAP.glyph.get(logoCellKey(x, y))
  if (direct !== undefined) return direct
  return LOGO_NEAR.map(([dx, dy]) => context.MAP.glyph.get(logoCellKey(x + dx, y + dy))).find(
    (item): item is number => item !== undefined,
  )
}

export const defaultLogoContext = buildLogoContext(logo)
