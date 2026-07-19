export type PermissionMode = "strict" | "configured" | "auto" | "yolo"

export type PermissionModeOption = {
  id: PermissionMode
  label: string
  description: string
  meta: string
}

export const PERMISSION_MODE_OPTIONS: readonly PermissionModeOption[] = [
  {
    id: "strict",
    label: "Strict",
    description: "Ask before every action that is not explicitly denied.",
    meta: "Maximum oversight",
  },
  {
    id: "configured",
    label: "Configured safeguards",
    description: "Use OpenCode defaults and your configured permission rules.",
    meta: "Recommended",
  },
  {
    id: "auto",
    label: "Auto-approve",
    description: "Approve prompts automatically while preserving explicit denials.",
    meta: "Trusted workspaces",
  },
  {
    id: "yolo",
    label: "YOLO",
    description: "Allow every action, including operations normally denied by policy.",
    meta: "Unrestricted",
  },
]

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODE_OPTIONS.some((option) => option.id === value)
}

export function permissionModeOption(mode: PermissionMode | undefined) {
  return PERMISSION_MODE_OPTIONS.find((option) => option.id === mode)
}
