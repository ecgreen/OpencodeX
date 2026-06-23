import type { ModelPickerOption } from "../lib/model-selection"
import { For, Show } from "solid-js"
import { isFreeOpencodeModel, modelValue } from "../lib/model-selection"
import { Icon } from "./icon"
import { ModalFrame } from "./modal-frame"
import { TextInput } from "./ui"

export function SessionModelPicker(props: {
  query: string
  favorites: string[]
  selectedModel: string
  favoriteOptions: ModelPickerOption[]
  recentOptions: ModelPickerOption[]
  providerGroups: Array<{ provider: ModelPickerOption["provider"]; models: ModelPickerOption["model"][] }>
  close: () => void
  setQuery: (value: string) => void
  select: (providerID: string, modelID: string) => void
  toggleFavorite: (value: string) => void
}) {
  return (
    <ModalFrame
      title="Select model"
      description="Recent routes are listed first, matching the TUI picker."
      close={props.close}
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
          <For each={props.providerGroups}>
            {(group) => (
              <ModelPickerSection
                title={group.provider.name}
                selectedModel={props.selectedModel}
                favorites={props.favorites}
                options={group.models.map((model) => ({ provider: group.provider, model }))}
                select={props.select}
                toggleFavorite={props.toggleFavorite}
              />
            )}
          </For>
          <Show when={props.favoriteOptions.length === 0 && props.recentOptions.length === 0 && props.providerGroups.length === 0}>
            <p class="model-picker-empty">No matching models.</p>
          </Show>
        </div>
      </>
    </ModalFrame>
  )
}

function ModelPickerSection(props: { title: string; selectedModel: string; favorites: string[]; options: ModelPickerOption[]; select: (providerID: string, modelID: string) => void; toggleFavorite: (value: string) => void }) {
  return (
    <section class="model-picker-section">
      <h3>{props.title}</h3>
      <div>
        <For each={props.options}>
          {(option) => {
            const value = modelValue(option.provider.id, option.model.id)
            const favorite = () => props.favorites.includes(value)
            return (
              <button type="button" classList={{ selected: props.selectedModel === value }} onClick={() => props.select(option.provider.id, option.model.id)}>
                <span>{option.model.name ?? option.model.id}</span>
                <small>{option.provider.name}</small>
                <Show when={isFreeOpencodeModel(option.provider, option.model)}><em>Free</em></Show>
                <span
                  class="model-favorite-toggle"
                  classList={{ active: favorite() }}
                  role="button"
                  tabIndex={0}
                  aria-label={favorite() ? "Remove favorite" : "Add favorite"}
                  title={favorite() ? "Remove favorite" : "Add favorite"}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.toggleFavorite(value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    props.toggleFavorite(value)
                  }}
                >
                  <Icon name="star" />
                  {favorite() ? "Favorite" : "Add"}
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </section>
  )
}
