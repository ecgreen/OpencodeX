import type { JSX } from "solid-js"
import { For, splitProps } from "solid-js"
import { classes } from "./shared"

export type SkeletonShape = "text" | "title" | "block" | "circle"

export type SkeletonProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  shape?: SkeletonShape
  width?: string
  /** Render this many stacked lines; the last one is shortened. */
  lines?: number
}

/**
 * Tonal placeholder for async surfaces whose layout is already known.
 * Prefer this over a spinner wherever the final geometry is predictable.
 */
export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ["shape", "width", "lines", "class", "classList", "style"])
  const shape = () => local.shape ?? "text"
  const count = () => Math.max(1, local.lines ?? 1)
  return (
    <For each={Array.from({ length: count() })}>
      {(_, index) => (
        <span
          {...rest}
          aria-hidden="true"
          data-ui="skeleton"
          data-shape={shape()}
          class={classes("ui-skeleton", local.class)}
          classList={local.classList}
          style={{ width: index() === count() - 1 && count() > 1 ? "62%" : local.width, ...(local.style as object) }}
        />
      )}
    </For>
  )
}
