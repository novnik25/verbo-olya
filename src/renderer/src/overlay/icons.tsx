/**
 * Значки плавающей панели. Только SVG — эмодзи в интерфейсе не используем.
 * Общие атрибуты вынесены в svg, чтобы все значки были одной толщины и размера.
 */
export const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function IconGlobe(): JSX.Element {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </svg>
  )
}
export function IconMic(): JSX.Element {
  return (
    <svg {...svg}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}
export function IconSpeaker(): JSX.Element {
  return (
    <svg {...svg}>
      <polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}
export function IconTranslate(): JSX.Element {
  return (
    <svg {...svg}>
      <path d="M3 6h9M7.5 4v2c0 3.5-2 6.5-4.5 8" />
      <path d="M6 11c1.6 2.2 3.6 3.6 6 4.4" />
      <path d="M13 20l4.2-10 4.2 10M14.7 16.6h5" />
    </svg>
  )
}
export function IconSliders(): JSX.Element {
  return (
    <svg {...svg}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h9M17 18h3" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </svg>
  )
}
export function IconChevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg {...svg} width="14" height="14" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
export function IconCrop(): JSX.Element {
  return (
    <svg {...svg}>
      <path d="M3 7h11a3 3 0 0 1 3 3v11M7 3v11a3 3 0 0 0 3 3h11" />
    </svg>
  )
}
export function IconCheck(): JSX.Element {
  return (
    <svg {...svg} width="15" height="15" strokeWidth="2.2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
export function IconClose(): JSX.Element {
  return (
    <svg {...svg} width="14" height="14">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
export function IconCopy(): JSX.Element {
  return (
    <svg {...svg} width="14" height="14">
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </svg>
  )
}
