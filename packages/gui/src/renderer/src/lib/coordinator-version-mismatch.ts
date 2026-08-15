export function canAttachCoordinatorAnyway(message: unknown) {
  return typeof message === "string" && message.includes("CoordinatorVersionMismatchError")
}
