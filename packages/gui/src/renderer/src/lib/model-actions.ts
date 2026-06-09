import type { GuiSnapshot } from "./store"
import { isFreeOpencodeModel, modelPickerOptions, modelValue, selectedModelVariants } from "./model-selection"

type ChoiceOption = { value: string; title: string; description?: string; meta?: string }

type ChoicePrompt = {
  title: string
  message?: string
  options: ChoiceOption[]
}

export async function runSwitchModelAction(input: {
  providers: GuiSnapshot["providers"]
  alert: (message: string) => void
  askChoice: (input: ChoicePrompt) => Promise<string | undefined>
  setSelectedModel: (value: string) => void
  setSelectedVariant: (value: string) => void
  rememberModel: (value: string) => void
}) {
  const options = modelPickerOptions(input.providers)
  if (options.length === 0) return input.alert("No models available.")
  const value = await input.askChoice({
    title: "Switch Model",
    message: "Choose the model used for the active composer.",
    options: options.map((option) => ({
      value: modelValue(option.provider.id, option.model.id),
      title: option.model.name ?? option.model.id,
      description: option.provider.name,
      meta: isFreeOpencodeModel(option.provider, option.model) ? "Free" : undefined,
    })),
  })
  if (!value) return
  input.setSelectedModel(value)
  input.setSelectedVariant("")
  input.rememberModel(value)
}

export async function runSwitchAgentAction(input: {
  agents: GuiSnapshot["agents"]
  alert: (message: string) => void
  askChoice: (input: ChoicePrompt) => Promise<string | undefined>
  setSelectedAgent: (value: string) => void
}) {
  const agents = input.agents.filter((agent) => !agent.hidden && agent.mode !== "subagent")
  if (agents.length === 0) return input.alert("No agents available.")
  const agent = await input.askChoice({
    title: "Switch Agent",
    message: "Choose the agent used for the active composer.",
    options: agents.map((item) => ({
      value: item.name,
      title: item.name,
      description: item.description,
      meta: item.mode,
    })),
  })
  if (agent) input.setSelectedAgent(agent)
}

export async function runSwitchVariantAction(input: {
  providers: GuiSnapshot["providers"]
  selectedModel: string
  alert: (message: string) => void
  askChoice: (input: ChoicePrompt) => Promise<string | undefined>
  setSelectedVariant: (value: string) => void
}) {
  const variants = selectedModelVariants(input.providers, input.selectedModel)
  if (variants.length === 0) return input.alert("The selected model does not expose variants.")
  const variant = await input.askChoice({
    title: "Switch Model Variant",
    message: "Choose the model variant used for the active composer.",
    options: [
      { value: "", title: "Default", description: "Use the provider default variant" },
      ...variants.map((item) => ({ value: item, title: item })),
    ],
  })
  if (variant !== undefined) input.setSelectedVariant(variant)
}

export function runCycleVariantAction(input: {
  providers: GuiSnapshot["providers"]
  selectedModel: string
  selectedVariant: string
  alert: (message: string) => void
  setSelectedVariant: (value: string) => void
}) {
  const variants = selectedModelVariants(input.providers, input.selectedModel)
  if (variants.length === 0) return input.alert("The selected model does not expose variants.")
  const options = ["", ...variants]
  const index = options.indexOf(input.selectedVariant)
  input.setSelectedVariant(options[index >= 0 ? (index + 1) % options.length : 1])
}
