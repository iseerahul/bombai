import raw from '../../shared/categories.json'

export interface CategorySpec {
  label: string
  short: string
  icon: string
  color: string
  /** Loaded on startup rather than on demand. Only tiny, high-value civic layers. */
  eager: boolean
  /** Civic layers get the community-status treatment; commercial ones don't. */
  civic: boolean
  overpass: { key: string; values: string[] }[]
  synonyms: string[]
}

/**
 * Single source of truth, shared with scripts/build-data.mjs. Editing the JSON
 * changes both what the pipeline fetches and what the app knows how to show, so
 * the two can never drift apart.
 */
export const CATEGORIES = raw as Record<string, CategorySpec>

export const CATEGORY_KEYS = Object.keys(CATEGORIES)

export const EAGER_CATEGORIES = CATEGORY_KEYS.filter((k) => CATEGORIES[k].eager)

export function categoryColor(key: string): string {
  if (key === 'flood_spot') return '#0369a1'
  return CATEGORIES[key]?.color ?? '#64748b'
}

export function categoryLabel(key: string): string {
  if (key === 'flood_spot') return 'Flood-prone spot'
  return CATEGORIES[key]?.label ?? key
}

/*
 * The `icon` field in shared/categories.json is now unused by the app: emoji
 * were replaced by the stroke icon set in src/ui/Icon.tsx, which inherits text
 * colour and renders identically on every platform. The field is left in the
 * JSON because the data pipeline reads that file too, and removing a key it
 * doesn't use would be churn. Map category → glyph in `categoryIconName`.
 */

/**
 * "leisure=park" → "park". Built from the same Overpass rules the data
 * pipeline uses, so a subtype can never map to a category whose file does not
 * actually contain it.
 */
const SUBTYPE_TO_CATEGORY: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [key, spec] of Object.entries(CATEGORIES)) {
    for (const rule of spec.overpass ?? []) {
      for (const value of rule.values) map[`${rule.key}=${value}`] = key
    }
  }
  return map
})()

export function categoryForSubtype(subtype: string): string | null {
  return SUBTYPE_TO_CATEGORY[subtype] ?? null
}
