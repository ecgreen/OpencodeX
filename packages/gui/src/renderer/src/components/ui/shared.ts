export function classes(...values: Array<string | undefined | false>) {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ")
}

export type ControlSize = "compact" | "default" | "prominent"
export type ControlTone = "neutral" | "accent" | "danger" | "success" | "warning" | "info"
export type ControlAppearance = "solid" | "soft" | "outline" | "ghost"
