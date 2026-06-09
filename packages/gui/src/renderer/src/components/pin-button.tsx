import { Icon } from "./icon"

export function PinButton(props: { pinned: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="pin-toggle"
      classList={{ pinned: props.pinned }}
      title={`${props.pinned ? "Unpin" : "Pin"} ${props.label}`}
      aria-label={`${props.pinned ? "Unpin" : "Pin"} ${props.label}`}
      aria-pressed={props.pinned}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onClick()
      }}
    >
      <Icon name="pin" />
    </button>
  )
}
