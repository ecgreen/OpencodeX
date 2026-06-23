import { IconButton } from "./ui"

export function PinButton(props: { pinned: boolean; label: string; onClick: () => void }) {
  return (
    <IconButton
      class="pin-toggle"
      classList={{ pinned: props.pinned }}
      icon="pin"
      label={`${props.pinned ? "Unpin" : "Pin"} ${props.label}`}
      pressed={props.pinned}
      title={`${props.pinned ? "Unpin" : "Pin"} ${props.label}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onClick()
      }}
    />
  )
}
