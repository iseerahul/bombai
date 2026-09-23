/**
 * The icon set.
 *
 * These replaced emoji throughout the app. Emoji were free but they render as
 * a different typeface on every platform, can't inherit colour, and read as
 * decoration rather than as part of an interface — which undercuts an app whose
 * whole pitch is that it can be trusted.
 *
 * Everything here is a 24×24 stroke glyph on `currentColor`, so an icon takes
 * the colour of the text beside it and stays legible in both themes.
 */

export type IconName =
  | 'water'
  | 'toilet'
  | 'health'
  | 'pharmacy'
  | 'food'
  | 'atm'
  | 'police'
  | 'transit'
  | 'shelter'
  | 'bench'
  | 'park'
  | 'waterfront'
  | 'sports'
  | 'culture'
  | 'market'
  | 'flood'
  | 'pin'
  | 'rail'
  | 'close'
  | 'locate'
  | 'send'
  | 'shield'
  | 'flag'
  | 'external'
  | 'route'
  | 'clock'
  | 'check'
  | 'alert'
  | 'info'
  | 'accessible'
  | 'coin'
  | 'chevron-up'
  | 'chevron-down'
  | 'plus'
  | 'sparkle'

interface IconProps {
  name: IconName
  /** Pixel size; 16 for inline text, 18–20 for controls, 24 for headers. */
  size?: number
  className?: string
  /** Set only when the icon is the sole content of a control. */
  title?: string
}

/* Paths are stroke-only unless a glyph genuinely needs a filled counter. */
const PATHS: Record<IconName, JSX.Element> = {
  water: (
    <path d="M12 3.5s5.5 6 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5Z" />
  ),
  toilet: (
    <>
      <circle cx="8" cy="5" r="1.8" />
      <path d="M8 8.5c-1.6 0-2.5 1-2.7 2.4L4.8 14h1.6l.3 6h2.6l.3-6h1.6l-.5-3.1C10.5 9.5 9.6 8.5 8 8.5Z" />
      <circle cx="16.5" cy="5" r="1.8" />
      <path d="M16.5 8.5c-1.7 0-2.6 1-2.6 2.2L12.8 15h1.7l.3 5h3.4l.3-5h1.7l-1.1-4.3c0-1.2-.9-2.2-2.6-2.2Z" />
    </>
  ),
  health: (
    <>
      <path d="M4 20V7.5l8-4 8 4V20" />
      <path d="M9.5 12h5M12 9.5v5" />
    </>
  ),
  pharmacy: (
    <>
      <rect x="3.5" y="8" width="17" height="12.5" rx="2" />
      <path d="M7 8V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V8" />
      <path d="M9.5 14.2h5M12 11.7v5" />
    </>
  ),
  food: (
    <>
      <path d="M6 3.5v7a2.5 2.5 0 0 0 5 0v-7M8.5 3.5v7M8.5 13v7.5" />
      <path d="M17.5 3.5c-1.5 1-2.2 2.6-2.2 4.6s.7 3.2 2.2 3.6v8.8" />
    </>
  ),
  atm: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6.5 14.5h4" />
    </>
  ),
  police: (
    <>
      <path d="M12 3.2 19 6v5.6c0 4.2-2.8 7.4-7 9.2-4.2-1.8-7-5-7-9.2V6l7-2.8Z" />
      <path d="m12 8.6 1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3 1-2.1Z" />
    </>
  ),
  transit: (
    <>
      <rect x="5" y="3.5" width="14" height="13" rx="3" />
      <path d="M5 11h14" />
      <path d="M8.5 20.5 7 17M15.5 20.5 17 17" />
      <circle cx="8.8" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  shelter: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M12 11v9.5" />
      <path d="M6.5 11c0 2 1.2 3.2 2.8 3.2S12 13 12 11M12 11c0 2 1.2 3.2 2.8 3.2S17.5 13 17.5 11" />
    </>
  ),
  bench: (
    <>
      <path d="M3 9.5h18M3 13h18" />
      <path d="M5 9.5v9M19 9.5v9M5 16h14" />
    </>
  ),
  park: (
    <>
      <path d="M12 21v-5" />
      <path d="M12 16a5.5 5.5 0 0 0 5.5-5.5c0-1.4-.6-2.7-1.5-3.6A4.5 4.5 0 0 0 12 3a4.5 4.5 0 0 0-4 4.9A5 5 0 0 0 6.5 10.5 5.5 5.5 0 0 0 12 16Z" />
    </>
  ),
  waterfront: (
    <>
      <path d="M2.5 17c1.6 0 1.6 1.5 3.2 1.5S7.3 17 8.9 17s1.6 1.5 3.2 1.5S13.7 17 15.3 17s1.6 1.5 3.2 1.5S20.1 17 21.7 17" />
      <path d="M4 13.5C4 9 7.6 5.5 12 5.5s8 3.5 8 8" />
      <circle cx="12" cy="3.5" r="1.6" />
    </>
  ),
  sports: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
      <path d="M5.8 5.8c3.4 3.4 9 3.4 12.4 0M5.8 18.2c3.4-3.4 9-3.4 12.4 0" />
    </>
  ),
  culture: (
    <>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
      <path d="M3 20h18" />
    </>
  ),
  market: (
    <>
      <path d="M4 8h16l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3Z" />
      <path d="M8.5 8V6.2a3.5 3.5 0 0 1 7 0V8" />
    </>
  ),
  flood: (
    <>
      <path d="M2.5 15.5c1.6 0 1.6 1.4 3.2 1.4s1.6-1.4 3.2-1.4 1.6 1.4 3.2 1.4 1.6-1.4 3.2-1.4 1.6 1.4 3.2 1.4 1.6-1.4 3.2-1.4" />
      <path d="M2.5 19.5c1.6 0 1.6 1.4 3.2 1.4s1.6-1.4 3.2-1.4 1.6 1.4 3.2 1.4 1.6-1.4 3.2-1.4 1.6 1.4 3.2 1.4 1.6-1.4 3.2-1.4" />
      <path d="M12 2.5s3.6 3.9 3.6 6.2a3.6 3.6 0 1 1-7.2 0C8.4 6.4 12 2.5 12 2.5Z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10.2" r="2.6" />
    </>
  ),
  rail: (
    <>
      <path d="M7 2.5v19M17 2.5v19" />
      <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="8" />
      <path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3" />
    </>
  ),
  send: <path d="M4.5 12 20 4.5l-3.6 15.5-4.3-5.6-5.4-1.6Zm7.6 2.4L20 4.5" />,
  shield: (
    <>
      <path d="M12 3.2 19 6v5.6c0 4.2-2.8 7.4-7 9.2-4.2-1.8-7-5-7-9.2V6l7-2.8Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21.5V3.5" />
      <path d="M5.5 4.5h11l-1.8 3.6L16.5 12h-11" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M6 8v5.5a4 4 0 0 0 4 4h5.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3 1.8" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3.8 21 19.5H3L12 3.8Z" />
      <path d="M12 10v4M12 16.6v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.7v.1" />
    </>
  ),
  accessible: (
    <>
      <circle cx="12.5" cy="4.6" r="1.9" />
      <path d="M12.5 8.2v4.4h4.2" />
      <path d="M12.5 12.6c-2.9 0-5 2.2-5 4.9a5 5 0 0 0 9.5 2.1" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.4 9.2c-.5-.8-1.4-1.2-2.4-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.3 5 4 0 1.2-1.1 2-2.6 2-1.1 0-2-.4-2.5-1.2" />
      <path d="M12 6.4v11.2" />
    </>
  ),
  'chevron-up': <path d="m6 14.5 6-6 6 6" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  sparkle: (
    <>
      <path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9 12 3.5Z" />
      <path d="M18.5 16.5 19.2 19l2.3.7-2.3.8-.7 2.4-.7-2.4-2.3-.8 2.3-.7.7-2.5Z" />
    </>
  ),
}

export default function Icon({ name, size = 16, className = '', title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      // A decorative icon must not be announced; a standalone one must be.
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  )
}

/** Category key → glyph. Keep in step with shared/categories.json. */
const CATEGORY_ICONS: Record<string, IconName> = {
  drinking_water: 'water',
  toilets: 'toilet',
  health: 'health',
  pharmacy: 'pharmacy',
  food: 'food',
  atm: 'atm',
  police: 'police',
  transit: 'transit',
  shelter: 'shelter',
  bench: 'bench',
  flood_spot: 'flood',
  park: 'park',
  waterfront: 'waterfront',
  sports: 'sports',
  culture: 'culture',
  market: 'market',
}

export function categoryIconName(category: string): IconName {
  return CATEGORY_ICONS[category] ?? 'pin'
}

/**
 * A category glyph in its own tinted disc.
 *
 * The tint comes from the category colour used on the map, so a pin and its
 * list row are recognisably the same thing — the main reason results and map
 * previously felt like two separate apps.
 */
export function CategoryBadge({
  category,
  color,
  size = 'md',
}: {
  category: string
  color: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const box = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-11 w-11' }[size]
  const glyph = { sm: 14, md: 17, lg: 21 }[size]

  return (
    <span
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full`}
      style={{
        // 14% tint of the category colour, with a matching hairline. Written as
        // colour-mix so one value drives both themes without a second palette.
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      <Icon name={categoryIconName(category)} size={glyph} />
    </span>
  )
}
