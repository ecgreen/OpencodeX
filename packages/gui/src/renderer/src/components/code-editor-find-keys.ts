export function codeEditorFindAction(key: string, shiftKey: boolean) {
  if (key === "Escape") return "close" as const
  if (key !== "Enter") return
  return shiftKey ? "previous" as const : "next" as const
}
