import type { Poi, SearchRequest, SearchFilters } from '../types'
import { CATEGORIES } from '../config/categories'
import { isOpenNow } from './openingHours'

/**
 * The local POI index.
 *
 * Everything here runs in the browser against files already downloaded. There
 * is exactly one network call per category — fetching its baked GeoJSON — and
 * after that, searching is pure computation on the device. The user's location
 * is never an argument to anything that touches the network.
 *
 * At Mumbai's data volume (~76 water points, ~360+ toilets, ~2k health, a few
 * thousand food) a linear scan with a distance filter is comfortably fast.
 * Resist adding a spatial index until a profiler says to.
 */

const loaded = new Map<string, Poi[]>()
const inflight = new Map<string, Promise<Poi[]>>()

export class DataUnavailableError extends Error {
  constructor(readonly category: string) {
    super(
      `The "${category}" layer hasn't been built yet. Run \`npm run data\` to generate it.`
    )
    this.name = 'DataUnavailableError'
  }
}

interface GeoJsonFeature {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | null> & {
    id: string
    name: string | null
    category: string
    source: string
  }
}

function featureToPoi(f: GeoJsonFeature): Poi {
  const { id, name, category, subtype, source, ...rest } = f.properties
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (v != null) tags[k] = String(v)
  }
  return {
    id,
    name: name ?? null,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    category,
    subtype: subtype ?? null,
    source: (source as Poi['source']) ?? 'osm',
    tags,
  }
}

/** Fetch and cache one category's baked GeoJSON. Safe to call concurrently. */
export async function loadCategory(category: string): Promise<Poi[]> {
  const cached = loaded.get(category)
  if (cached) return cached

  const pending = inflight.get(category)
  if (pending) return pending

  const file = category === 'flood_spot' ? 'flood_spots' : category
  const promise = (async () => {
    let res: Response
    try {
      res = await fetch(`${import.meta.env.BASE_URL}data/${file}.geojson`)
    } catch {
      throw new DataUnavailableError(category)
    }
    if (!res.ok) throw new DataUnavailableError(category)

    const json = (await res.json()) as { features: GeoJsonFeature[] }
    const pois = json.features.map(featureToPoi)
    loaded.set(category, pois)
    inflight.delete(category)
    return pois
  })()

  inflight.set(category, promise)
  promise.catch(() => inflight.delete(category))
  return promise
}

export function isLoaded(category: string): boolean {
  return loaded.has(category)
}

/** Metres between two WGS84 points. */
export function distanceM(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLon = (bLon - aLon) * toRad
  const la1 = aLat * toRad
  const la2 = bLat * toRad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

function matchesText(poi: Poi, needle: string): boolean {
  if (!needle) return true
  const haystack = [
    poi.name ?? '',
    poi.tags.cuisine ?? '',
    poi.tags['healthcare:speciality'] ?? '',
    poi.tags.healthcare ?? '',
    poi.tags.operator ?? '',
    poi.tags.description ?? '',
  ]
    .join(' ')
    .toLowerCase()

  // Every word must appear somewhere — "cheese cake" shouldn't match a random cafe.
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

function passesFilters(poi: Poi, filters: SearchFilters): boolean {
  if (filters.wheelchair) {
    const v = poi.tags.wheelchair
    // Only 'yes' counts. 'limited', missing, or 'no' all fail an explicit request.
    if (v !== 'yes') return false
  }

  if (filters.free) {
    const fee = poi.tags.fee
    // Missing `fee` is ambiguous; treat only an explicit charge as disqualifying.
    if (fee === 'yes') return false
  }

  if (filters.openNow) {
    // 'unknown' is kept deliberately — see openingHours.ts. Filtering on unknown
    // would hide most of Mumbai, since opening_hours coverage here is thin.
    if (isOpenNow(poi.tags.opening_hours) === 'closed') return false
  }

  if (filters.working) {
    // Community verdict wins over everything else when it exists.
    if (poi.status?.verdict === 'broken') return false
  }

  return true
}

/**
 * Run a search entirely on-device.
 * Categories that aren't loaded yet are fetched first.
 */
export async function search(req: SearchRequest): Promise<Poi[]> {
  const categories = req.categories.filter((c) => c === 'flood_spot' || c in CATEGORIES)
  if (!categories.length) return []

  const sets = await Promise.all(categories.map(loadCategory))

  const results: Poi[] = []
  for (const set of sets) {
    for (const poi of set) {
      const d = distanceM(req.center.lat, req.center.lon, poi.lat, poi.lon)
      if (d > req.radiusM) continue
      if (req.text && !matchesText(poi, req.text)) continue
      if (!passesFilters(poi, req.filters)) continue
      results.push({ ...poi, distanceM: d })
    }
  }

  results.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
  return results.slice(0, req.limit ?? 60)
}

/**
 * Search with a widening radius.
 *
 * Mumbai's civic data is sparse — 76 drinking water points citywide — so a
 * strict 1km radius often returns nothing and reads as "app is broken" rather
 * than "the city has few fountains". Widening and reporting the radius we
 * actually used is more useful and more honest.
 */
export async function searchWidening(
  req: SearchRequest,
  steps: number[] = [1000, 2500, 5000, 10000]
): Promise<{ results: Poi[]; radiusUsedM: number }> {
  // Always try the requested radius first, then widen past it. Sorting and
  // de-duplicating keeps the ladder sane whatever `steps` was passed.
  const radii = [...new Set([req.radiusM, ...steps.filter((s) => s > req.radiusM)])].sort(
    (a, b) => a - b
  )

  let last: Poi[] = []
  for (const radiusM of radii) {
    last = await search({ ...req, radiusM })
    if (last.length >= 3) return { results: last, radiusUsedM: radiusM }
  }
  return { results: last, radiusUsedM: radii[radii.length - 1] }
}

/**
 * Every POI currently in memory, for the ambient "click anything" map layer.
 * Returns a flat array; callers should treat it as read-only.
 */
export function allLoadedPois(): Poi[] {
  const all: Poi[] = []
  for (const set of loaded.values()) all.push(...set)
  return all
}

/** Which categories are currently in memory. Drives layer-visibility UI. */
export function loadedCategories(): string[] {
  return [...loaded.keys()]
}

/** Look up POIs by id across everything already loaded — used to resolve LLM picks. */
export function findLoadedByIds(ids: string[]): Poi[] {
  const wanted = new Set(ids)
  const found: Poi[] = []
  for (const set of loaded.values()) {
    for (const poi of set) {
      if (wanted.has(poi.id)) found.push(poi)
    }
  }
  // Preserve the order the caller asked for (the LLM's ranking).
  return ids.map((id) => found.find((p) => p.id === id)).filter((p): p is Poi => !!p)
}

// ---------------------------------------------------------------------------
// Geocoder fallback
// ---------------------------------------------------------------------------

/**
 * Ask the server's geocoder for a name the local corpus doesn't hold.
 *
 * The shipped data covers fifteen categories; OSM has hundreds. "Kitab Khana"
 * is `shop=books`, which we never baked and never could — the long tail is the
 * point of a tail. So a named search that finds nothing locally falls through
 * to here rather than claiming the place doesn't exist.
 *
 * Returns an empty array on any failure. A geocoder being down should degrade
 * the answer, never break the search.
 */
export async function geocode(query: string): Promise<Poi[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as {
      results?: {
        id: string
        name: string
        address: string | null
        lat: number
        lon: number
        subtype: string | null
        category: string
      }[]
    }
    return (body.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      category: r.category,
      subtype: r.subtype,
      source: 'osm' as const,
      tags: (r.address ? { description: r.address } : {}) as Record<string, string>,
    }))
  } catch {
    return []
  }
}
