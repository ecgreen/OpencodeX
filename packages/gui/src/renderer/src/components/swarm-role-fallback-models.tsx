import type { OpencodeXSwarmFallbackModel, OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import { canAddSwarmRoleFallback, moveSwarmRoleFallback, removeSwarmRoleFallback } from "../lib/swarm-role-fallbacks"
import { Button, IconButton, Select } from "./ui"

export function SwarmRoleFallbackModels(props: {
  role: OpencodeXSwarmRoleInput
  providers: Provider[]
  connectedProviderIDs: string[]
  update: (fallbackModels: OpencodeXSwarmFallbackModel[]) => void
  openModelPicker: (index: number | "new") => void
}) {
  const fallbacks = createMemo(() => props.role.fallbackModels ?? [])
  const summary = (fallback: OpencodeXSwarmFallbackModel) => {
    const provider = props.providers.find((item) => item.id === fallback.providerID)
    return {
      provider: provider?.name ?? fallback.providerID,
      model: provider?.models[fallback.modelID]?.name ?? fallback.modelID,
    }
  }
  const variants = (fallback: OpencodeXSwarmFallbackModel) => {
    const model = props.providers.find((provider) => provider.id === fallback.providerID)?.models[fallback.modelID]
    return ["default", ...Object.keys(model?.variants ?? {})]
  }
  const effortLabel = (value: string) => (value === "default" ? "Default" : value.charAt(0).toUpperCase() + value.slice(1))

  function updateFallback(index: number, update: (model: OpencodeXSwarmFallbackModel) => OpencodeXSwarmFallbackModel) {
    props.update(fallbacks().map((model, currentIndex) => (currentIndex === index ? update(model) : model)))
  }

  return (
    <section class="swarm-role-fallbacks">
      <header>
        <div>
          <strong>Fallback models</strong>
          <span>Used in order when this specialist's primary model reaches a usage or quota limit.</span>
        </div>
        <Button appearance="outline" size="compact" icon="plus" type="button" disabled={!canAddSwarmRoleFallback(fallbacks())} onClick={() => props.openModelPicker("new")}>
          Add fallback
        </Button>
      </header>
      <Show when={fallbacks().length > 0} fallback={<p>No fallback models configured.</p>}>
        <div class="swarm-role-fallback-list">
          <For each={fallbacks()}>
            {(fallback, index) => (
              <div class="swarm-role-fallback-row">
                <span class="swarm-role-fallback-order">{index() + 1}</span>
                <Button appearance="ghost" class="swarm-model-button" type="button" onClick={() => props.openModelPicker(index())}>
                  <strong>{summary(fallback).model}</strong>
                  <small>{summary(fallback).provider}</small>
                </Button>
                <Show when={variants(fallback).length > 1}>
                  <Select<string>
                    label="Effort"
                    options={variants(fallback)}
                    current={fallback.variant && variants(fallback).includes(fallback.variant) ? fallback.variant : "default"}
                    optionValue={(value) => value}
                    optionLabel={effortLabel}
                    onSelect={(value) => updateFallback(index(), (current) => ({
                      ...current,
                      variant: value && value !== "default" ? value : undefined,
                    }))}
                  />
                </Show>
                <div class="swarm-role-fallback-actions">
                  <IconButton appearance="ghost" size="compact" icon="arrowUp" label={`Move fallback ${index() + 1} up`} disabled={index() === 0} onClick={() => props.update(moveSwarmRoleFallback(fallbacks(), index(), -1))} />
                  <IconButton appearance="ghost" size="compact" icon="arrowDown" label={`Move fallback ${index() + 1} down`} disabled={index() === fallbacks().length - 1} onClick={() => props.update(moveSwarmRoleFallback(fallbacks(), index(), 1))} />
                  <IconButton appearance="ghost" tone="danger" size="compact" icon="trash" label={`Remove fallback ${index() + 1}`} onClick={() => props.update(removeSwarmRoleFallback(fallbacks(), index()))} />
                </div>
                <Show when={!props.connectedProviderIDs.includes(fallback.providerID)}>
                  <small class="swarm-model-warning">{summary(fallback).provider} is not connected.</small>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
