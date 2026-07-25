import type { Provider } from "@opencode-ai/sdk/v2/client"
import type { ModelPickerOption } from "../lib/model-selection"
import { For, Show, createMemo, createSignal } from "solid-js"
import { providerSectionExpanded, providerSectionLimit } from "../lib/model-picker-sections"
import { isFreeOpencodeModel, modelValue } from "../lib/model-selection"
import { Icon } from "./icon"
import { ModalFrame } from "./modal-frame"
import { Button, TextInput } from "./ui"

export type ModelPickerProviderGroup = { provider: Provider; models: Provider["models"][string][] }

export function SessionModelPicker(props: {
  query: string
  searching: boolean
  favorites: string[]
  selectedModel: string
  favoriteOptions: ModelPickerOption[]
  recentOptions: ModelPickerOption[]
  providerGroups: ModelPickerProviderGroup[]
  connectedProviderIDs: string[]
  close: () => void
  setQuery: (value: string) => void
  select: (providerID: string, modelID: string) => void
  toggleFavorite: (value: string) => void
  connectProvider?: (providerID: string) => void
}) {
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})
  const [showAll, setShowAll] = createSignal<Record<string, boolean>>({})
  const groupIDs = createMemo(() => props.providerGroups.map((group) => group.provider.id))
  const groupByID = createMemo(() => new Map(props.providerGroups.map((group) => [group.provider.id, group])))
  const empty = () => props.favoriteOptions.length === 0 && props.recentOptions.length === 0 && props.providerGroups.length === 0
  const expanded = (providerID: string, index: number) =>
    providerSectionExpanded({ override: overrides()[providerID], searching: props.searching, index })
  const toggle = (providerID: string, index: number) => {
    const next = !expanded(providerID, index)
    setOverrides((current) => ({ ...current, [providerID]: next }))
  }

  return (
    <ModalFrame
      title="Select model"
      description="Search models or expand a provider. Recent routes are listed first."
      close={props.close}
      closeSize="prominent"
      class="model-picker-modal"
    >
      <>
        <TextInput value={props.query} onInput={(event) => props.setQuery(event.currentTarget.value)} placeholder="Search models or providers" autofocus />
        <div class="model-picker-list">
          <Show when={props.favoriteOptions.length > 0}>
            <ModelPickerSection title="Favorites" selectedModel={props.selectedModel} favorites={props.favorites} options={props.favoriteOptions} select={props.select} toggleFavorite={props.toggleFavorite} />
          </Show>
          <Show when={props.recentOptions.length > 0}>
            <ModelPickerSection title="Recently used" selectedModel={props.selectedModel} favorites={props.favorites} options={props.recentOptions} select={props.select} toggleFavorite={props.toggleFavorite} />
          </Show>
          <For each={groupIDs()}>
            {(providerID, index) => (
              <ProviderSection
                group={groupByID().get(providerID)}
                connected={props.connectedProviderIDs.includes(providerID)}
                expanded={expanded(providerID, index())}
                limit={providerSectionLimit(showAll()[providerID] === true)}
                selectedModel={props.selectedModel}
                favorites={props.favorites}
                select={props.select}
                toggleExpanded={() => toggle(providerID, index())}
                showAll={() => setShowAll((current) => ({ ...current, [providerID]: true }))}
                toggleFavorite={props.toggleFavorite}
                connectProvider={props.connectProvider}
              />
            )}
          </For>
          <Show when={empty()}>
            <p class="model-picker-empty">No matching models.</p>
          </Show>
        </div>
      </>
    </ModalFrame>
  )
}

function ProviderSection(props: {
  group?: ModelPickerProviderGroup
  connected: boolean
  expanded: boolean
  limit: number
  selectedModel: string
  favorites: string[]
  select: (providerID: string, modelID: string) => void
  toggleExpanded: () => void
  showAll: () => void
  toggleFavorite: (value: string) => void
  connectProvider?: (providerID: string) => void
}) {
  const models = createMemo(() => props.group?.models ?? [])
  const visible = createMemo(() => (props.expanded ? models().slice(0, props.limit) : []))
  const hidden = createMemo(() => models().length - visible().length)
  return (
    <Show when={props.group}>
      {(group) => (
        <section class="model-picker-section" classList={{ disconnected: !props.connected }}>
          <Button appearance="ghost" type="button" class="model-picker-section-toggle" aria-expanded={props.expanded} onClick={props.toggleExpanded}>
            <Icon name={props.expanded ? "chevronDown" : "chevronRight"} />
            <span>{group().provider.name}</span>
            <Show when={props.connected} fallback={<span class="provider-auth-warning">Not connected</span>}>
              <span class="provider-auth-badge" title="Authenticated provider" aria-label="Authenticated provider">
                <Icon name="check" />
              </span>
            </Show>
            <small>{models().length} models</small>
          </Button>
          <Show when={props.expanded}>
            <Show when={!props.connected && props.connectProvider}>
              {(connect) => (
                <p class="provider-connect-hint">
                  <span>Add credentials to send messages with {group().provider.name}.</span>
                  <Button appearance="outline" type="button" onClick={() => connect()(group().provider.id)}>Connect</Button>
                </p>
              )}
            </Show>
            <div>
              <For each={visible()}>
                {(model) => (
                  <ModelOptionCard
                    provider={group().provider}
                    model={model}
                    selectedModel={props.selectedModel}
                    favorites={props.favorites}
                    select={props.select}
                    toggleFavorite={props.toggleFavorite}
                  />
                )}
              </For>
            </div>
            <Show when={hidden() > 0}>
              <Button appearance="ghost" type="button" class="model-picker-show-all" onClick={props.showAll}>
                Show {hidden()} more
              </Button>
            </Show>
          </Show>
        </section>
      )}
    </Show>
  )
}

function ModelPickerSection(props: {
  title: string
  selectedModel: string
  favorites: string[]
  options: ModelPickerOption[]
  select: (providerID: string, modelID: string) => void
  toggleFavorite: (value: string) => void
}) {
  return (
    <section class="model-picker-section">
      <h3 class="model-picker-section-heading">{props.title}</h3>
      <div>
        <For each={props.options}>
          {(option) => (
            <ModelOptionCard
              provider={option.provider}
              model={option.model}
              selectedModel={props.selectedModel}
              favorites={props.favorites}
              select={props.select}
              toggleFavorite={props.toggleFavorite}
            />
          )}
        </For>
      </div>
    </section>
  )
}

function ModelOptionCard(props: {
  provider: Provider
  model: Provider["models"][string]
  selectedModel: string
  favorites: string[]
  select: (providerID: string, modelID: string) => void
  toggleFavorite: (value: string) => void
}) {
  const value = createMemo(() => modelValue(props.provider.id, props.model.id))
  const favorite = () => props.favorites.includes(value())
  return (
    <div class="model-option-card" classList={{ selected: props.selectedModel === value() }}>
      <Button appearance="ghost" type="button" class="model-option-select" onClick={() => props.select(props.provider.id, props.model.id)}>
        <span class="model-option-header">
          <span class="model-option-name">{props.model.name ?? props.model.id}</span>
          <Show when={isFreeOpencodeModel(props.provider, props.model)}><em>Free</em></Show>
        </span>
        <small>{props.provider.name}</small>
      </Button>
      <Button appearance="ghost" type="button" class="model-favorite-toggle" classList={{ active: favorite() }} aria-label={favorite() ? "Remove favorite" : "Add favorite"} title={favorite() ? "Remove favorite" : "Add favorite"} onClick={() => props.toggleFavorite(value())}>
        <Icon name="star" />
        {favorite() ? "Favorite" : "Add"}
      </Button>
    </div>
  )
}
