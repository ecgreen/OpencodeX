import type { MessageBundle, PromptPart } from "./store-types"

export function isSteeringPart(part: PromptPart | MessageBundle["parts"][number]) {
  return part.type === "text" && part.synthetic === true && part.metadata?.steering === true
}
