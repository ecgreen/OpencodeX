export type ModelSelection = {
  providerID: string
  modelID: string
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  }
}

export function isModelSelection(value: unknown): value is ModelSelection {
  if (!value || typeof value !== "object") return false
  if (!("providerID" in value) || typeof value.providerID !== "string") return false
  return "modelID" in value && typeof value.modelID === "string"
}

export function modelSelectionKey(model: ModelSelection) {
  return `${model.providerID}/${model.modelID}`
}

export function sameModel(left: ModelSelection | undefined, right: ModelSelection | undefined) {
  return left?.providerID === right?.providerID && left?.modelID === right?.modelID
}

export function sessionModelPayload(model: ModelSelection, variant: string | undefined) {
  return {
    providerID: model.providerID,
    id: model.modelID,
    ...(variant && variant !== "default" ? { variant } : {}),
  }
}
