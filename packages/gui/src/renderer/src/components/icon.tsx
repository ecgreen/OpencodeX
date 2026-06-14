import type { JSX } from "solid-js"

export function Icon(props: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    activity: <path d="M3 12h4l2-7 4 14 2-7h5" />,
    check: <path d="M20 6 9 17l-5-5" />,
    dashboard: <path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
    branch: <path d="M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 8v3a5 5 0 0 0 5 5h5M18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 8v8" />,
    browser: <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 9h18M7 7h.01M10 7h.01" />,
    chevronDown: <path d="M6 9l6 6 6-6" />,
    chevronLeft: <path d="M15 6l-6 6 6 6" />,
    chevronRight: <path d="M9 6l6 6-6 6" />,
    circle: <circle cx="12" cy="12" r="8" />,
    copy: <path d="M8 8h11v13H8zM5 16H4a1 1 0 0 1-1-1V4h11a1 1 0 0 1 1 1v1" />,
    file: <path d="M6 3h8l4 4v14H6zM14 3v5h5" />,
    folder: <path d="M3 7h7l2 2h9v10H3z" />,
    "folder-open": <path d="M3 8h6.5l2 2H21M3 8v11h16l2-9H8l-2 3H3" />,
    github: <path d="M12 2a10 10 0 0 0-3 19c.5.1.7-.2.7-.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 2v3c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />,
    grip: <path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01" />,
    minus: <path d="M5 12h14" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
    panel: <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14M6 9h.01M6 12h.01M6 15h.01" />,
    pencil: <path d="M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17l-1 3zM14 7l3 3" />,
    pin: <path d="M12 17v5M5 3h14l-3 7 3 3v2H5v-2l3-3-3-7z" />,
    play: <path d="M8 5l11 7-11 7z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    save: <path d="M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7M10 6h4" />,
    search: <path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L21 21" />,
    send: <path d="M5 19 20 5M20 5l-5 14-3-7-7-3 15-4z" />,
    session: <path d="M4 5h16v11H8l-4 4z" />,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z" />,
    stop: <path d="M8 8h8v8H8z" />,
    swarm: <path d="M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 10l-3 6M14 10l3 6M9 19h6" />,
    trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />,
    undo: <path d="M9 7H4v5M4 12l5-5M5 12a7 7 0 1 0 2-5" />,
    views: <path d="M4 5h8v8H4zM12 11h8v8h-8z" />,
    warning: <path d="M12 3 2.5 20h19L12 3zM12 9v5M12 17h.01" />,
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
