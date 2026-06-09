import type { JSX } from "solid-js"

export function Icon(props: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    activity: <path d="M3 12h4l2-7 4 14 2-7h5" />,
    check: <path d="M20 6 9 17l-5-5" />,
    dashboard: <path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
    chevronDown: <path d="M6 9l6 6 6-6" />,
    chevronRight: <path d="M9 6l6 6-6 6" />,
    circle: <circle cx="12" cy="12" r="8" />,
    folder: <path d="M3 7h7l2 2h9v10H3z" />,
    "folder-open": <path d="M3 8h6.5l2 2H21M3 8v11h16l2-9H8l-2 3H3" />,
    grip: <path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
    panel: <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14M6 9h.01M6 12h.01M6 15h.01" />,
    play: <path d="M8 5l11 7-11 7z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    send: <path d="M5 19 20 5M20 5l-5 14-3-7-7-3 15-4z" />,
    session: <path d="M4 5h16v11H8l-4 4z" />,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />,
    stop: <path d="M8 8h8v8H8z" />,
    swarm: <path d="M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 10l-3 6M14 10l3 6M9 19h6" />,
    views: <path d="M4 5h8v8H4zM12 11h8v8h-8z" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
  }
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {paths[props.name] ?? paths.dashboard}
    </svg>
  )
}

export function DisclosureChevron() {
  return <span class="output-chevron"><Icon name="chevronRight" /></span>
}
