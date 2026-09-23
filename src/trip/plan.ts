import type { Fix, Poi, StopSpec, TripStop } from '../types'
import { CATEGORIES } from '../config/categories'
import { MUMBAI_CENTER, localityByName } from '../config/localities'
import { distanceM, loadCategory, searchWidening } from '../search/localIndex'

/**
 * Turning an interpreted itinerary into a resolvable trip.
 *
 * The interesting problem here is anchoring. When someone says "I want to eat
 * before taking the metro at MIDC", they mean restaurants near MIDC — not near
 * wherever they happen to be standing. So a category stop is anchored to the
 * nearest NAMED stop around it, preferring the one that comes after, because
 * that is what "before X" refers to.
 *
 * Everything here runs against the local index. No network calls.
 */

type Anchor = { lat: number; lon: number }

let stopCounter = 0
const nextStopId = () => `stop${++stopCounter}`

function labelFor(spec: StopSpec): string {
  if (spec.kind === 'origin') return 'Where you are'
  if (spec.kind === 'place') {
    return spec.area ? `${spec.name} (${spec.area})` : (spec.name ?? 'Destination')
  }
  const label = spec.category ? (CATEGORIES[spec.category]?.label ?? spec.category) : 'A stop'
  return spec.area ? `${label} in ${spec.area}` : label
}

/**
 * Find a specific named place, e.g. "MIDC" as a metro station.
 *
 * Matching is name-based against the local index, which is why the trip flow
 * doesn't need a geocoding service — and therefore never tells anyone which
 * places the user asked about.
 */
async function resolvePlace(
  spec: StopSpec,
  anchor: Anchor
): Promise<{ poi: Poi | null; options: Poi[] }> {
  const name = spec.name?.trim()
  if (!name) return { poi: null, options: [] }

  const locality = localityByName(spec.area ?? null)
  const center = locality ?? anchor

  // Try the stated category first, then widen to every category — people name
  // landmarks loosely, and "MIDC" could be tagged as a station, an office area
  // or a bus stop depending on who mapped it.
  const categoryAttempts: string[][] = []
  if (spec.category && (spec.category in CATEGORIES)) {
    categoryAttempts.push([spec.category])
  }
  categoryAttempts.push(['transit'])
  categoryAttempts.push(Object.keys(CATEGORIES))

  /**
   * Progressively shorter prefixes of the name.
   *
   * Search requires every word to match, so a wordy label finds nothing:
   * "MIDC Andheri Metro Station" fails against the mapped "MIDC - Andheri",
   * while "MIDC Andheri" succeeds. This also absorbs how people actually type
   * ("Andheri East railway station"), not just model verbosity.
   */
  const words = name.split(/\s+/).filter(Boolean)
  const nameAttempts: string[] = []
  for (let take = words.length; take >= 1; take--) {
    const attempt = words.slice(0, take).join(' ')
    if (!nameAttempts.includes(attempt)) nameAttempts.push(attempt)
  }

  const seen = new Set<string>()
  for (const attempt of nameAttempts) {
    for (const categories of categoryAttempts) {
      const key = `${attempt}|${categories.join(',')}`
      if (seen.has(key)) continue
      seen.add(key)

      const { results } = await searchWidening({
        categories,
        center: { lat: center.lat, lon: center.lon },
        radiusM: locality?.radiusM ?? 4000,
        filters: {},
        text: attempt,
        limit: 12,
      })

      if (results.length) {
        // Prefer a real name match over merely containing the words.
        const lowered = attempt.toLowerCase()
        const exact = results.find((r) => (r.name ?? '').toLowerCase() === lowered)
        const startsWith = results.find((r) =>
          (r.name ?? '').toLowerCase().startsWith(lowered)
        )
        return { poi: exact ?? startsWith ?? results[0], options: results }
      }
    }
  }

  return { poi: null, options: [] }
}

/**
 * Corridor for an open-ended stop: where you'll be before it and after it.
 * Either end may be unknown (no location shared, or it's the last stop).
 */
interface Corridor {
  prev: Anchor | null
  next: Anchor | null
}

/**
 * Extra walking this candidate costs versus going straight from prev to next.
 *
 * This is the ranking rule the whole feature turns on. Sorting by plain
 * distance from one end recommends a stall that is close but behind you;
 * sorting by detour recommends the one that is barely off your line, even if
 * it is further away. Detour is what the walk actually costs.
 */
function detourFor(poi: Poi, corridor: Corridor): number {
  const { prev, next } = corridor

  if (prev && next) {
    const direct = distanceM(prev.lat, prev.lon, next.lat, next.lon)
    const viaStop =
      distanceM(prev.lat, prev.lon, poi.lat, poi.lon) +
      distanceM(poi.lat, poi.lon, next.lat, next.lon)
    // Never negative: a stop cannot make the journey shorter than the direct line.
    return Math.max(0, viaStop - direct)
  }

  // Only one end known — an out-and-back, so the detour is twice the hop.
  const solo = prev ?? next
  if (solo) return 2 * distanceM(solo.lat, solo.lon, poi.lat, poi.lon)
  return 0
}

/**
 * Offer nearby candidates for an open-ended stop like "somewhere to eat",
 * ranked by how much extra walking each one costs.
 */
async function resolveCategory(
  spec: StopSpec,
  corridor: Corridor
): Promise<{ poi: Poi | null; options: Poi[] }> {
  const category = spec.category
  if (!category || !(category in CATEGORIES)) return { poi: null, options: [] }

  const locality = localityByName(spec.area ?? null)
  // Search around the corridor's midpoint when both ends are known, so places
  // near either end are reachable in one pass.
  const anchor: Anchor =
    locality ??
    (corridor.prev && corridor.next
      ? {
          lat: (corridor.prev.lat + corridor.next.lat) / 2,
          lon: (corridor.prev.lon + corridor.next.lon) / 2,
        }
      : (corridor.prev ?? corridor.next ?? MUMBAI_CENTER))

  // Radius has to cover the corridor itself plus a margin either side, or a
  // legitimate stop near one end falls outside the search.
  const spanM =
    corridor.prev && corridor.next
      ? distanceM(corridor.prev.lat, corridor.prev.lon, corridor.next.lat, corridor.next.lon)
      : 0
  const radiusM = locality?.radiusM ?? Math.max(1200, spanM / 2 + 900)

  const { results } = await searchWidening({
    categories: [category],
    center: { lat: anchor.lat, lon: anchor.lon },
    radiusM,
    filters: {},
    limit: 60,
  })

  const ranked = results
    .filter((p) => p.name)
    .map((p) => ({ ...p, detourM: Math.round(detourFor(p, corridor)) }))
    .sort((a, b) => a.detourM - b.detourM)
    .slice(0, 12)

  // Deliberately no auto-selection: the user picks, then the route is drawn.
  return { poi: null, options: ranked }
}

/**
 * Resolve an itinerary.
 *
 * Two passes: named places first (they're absolute), then category stops
 * anchored to their resolved neighbours.
 */
export async function buildTrip(
  specs: StopSpec[],
  ctx: { userFix: Fix | null }
): Promise<TripStop[]> {
  // Make sure every category involved is loaded before anchoring decisions.
  await Promise.all(
    specs
      .map((s) => s.category)
      .filter((c): c is string => !!c && c in CATEGORIES)
      .map((c) => loadCategory(c).catch(() => []))
  )

  const stops: TripStop[] = specs.map((spec) => ({
    id: nextStopId(),
    spec,
    label: labelFor(spec),
    poi: null,
    options: [],
    fix: spec.kind === 'origin' ? (ctx.userFix ?? undefined) : undefined,
  }))

  // --- pass 1: origins and named places ---
  const fallbackAnchor: Anchor = ctx.userFix ?? MUMBAI_CENTER

  for (const stop of stops) {
    if (stop.spec.kind === 'place') {
      const { poi, options } = await resolvePlace(stop.spec, fallbackAnchor)
      stop.poi = poi
      stop.options = options
      if (poi) stop.label = poi.name ?? stop.label
    }
  }

  /** Position of a stop, if it has one yet. */
  const anchorOf = (stop: TripStop): Anchor | null => {
    if (stop.poi) return { lat: stop.poi.lat, lon: stop.poi.lon }
    if (stop.fix) return { lat: stop.fix.lat, lon: stop.fix.lon }
    return null
  }

  // --- pass 2: category stops, anchored to the nearest resolved neighbour ---
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    if (stop.spec.kind !== 'category') continue

    // The corridor is the leg this stop interrupts: the nearest fixed point
    // before it and the nearest one after it.
    let prev: Anchor | null = null
    for (let j = i - 1; j >= 0 && !prev; j--) prev = anchorOf(stops[j])
    let next: Anchor | null = null
    for (let j = i + 1; j < stops.length && !next; j++) next = anchorOf(stops[j])

    const { poi, options } = await resolveCategory(stop.spec, {
      prev: prev ?? (next ? null : fallbackAnchor),
      next,
    })
    stop.poi = poi
    stop.options = options
  }

  return stops
}

/** Ordered coordinates for the stops that are actually pinned down. */
export function routablePoints(stops: TripStop[]): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = []
  for (const stop of stops) {
    if (stop.poi) points.push({ lat: stop.poi.lat, lon: stop.poi.lon })
    else if (stop.fix) points.push({ lat: stop.fix.lat, lon: stop.fix.lon })
  }
  return points
}

/**
 * Whether a route can be drawn.
 *
 * An origin stop with no fix is NOT a blocker. The interpreter adds "start where
 * you are" to almost every trip, but sharing a location is optional — so if it's
 * missing we simply route from the first real stop instead of refusing. Treating
 * it as required was a bug: picking a restaurant did nothing, with no explanation.
 */
export function isTripComplete(stops: TripStop[]): boolean {
  const awaitingChoice = stops.some((s) => s.spec.kind !== 'origin' && !s.poi)
  return !awaitingChoice && routablePoints(stops).length >= 2
}

/** Stops the user still has to choose a place for. Origins are never listed. */
export function unresolvedStops(stops: TripStop[]): TripStop[] {
  return stops.filter((s) => s.spec.kind !== 'origin' && !s.poi)
}

/** True when the trip would route from your location but no location is shared. */
export function originNeedsLocation(stops: TripStop[]): boolean {
  return stops.some((s) => s.spec.kind === 'origin' && !s.fix && !s.poi)
}

/** Re-anchor later category stops after the user picks a place. */
export async function rechooseStop(
  stops: TripStop[],
  stopId: string,
  poi: Poi
): Promise<TripStop[]> {
  const updated = stops.map((s) => (s.id === stopId ? { ...s, poi, label: poi.name ?? s.label } : s))

  // Options for other open stops were computed against an anchor that may have
  // just moved, so refresh any that are still unpicked.
  for (let i = 0; i < updated.length; i++) {
    const stop = updated[i]
    if (stop.id === stopId || stop.poi || stop.spec.kind !== 'category') continue

    const at = (s: TripStop): Anchor | null =>
      s.poi ? { lat: s.poi.lat, lon: s.poi.lon } : s.fix ? { lat: s.fix.lat, lon: s.fix.lon } : null

    let prev: Anchor | null = null
    for (let j = i - 1; j >= 0 && !prev; j--) prev = at(updated[j])
    let next: Anchor | null = null
    for (let j = i + 1; j < updated.length && !next; j++) next = at(updated[j])
    if (!prev && !next) continue

    // Picking a place moves the corridor, so every remaining open stop is
    // re-ranked against the new geometry rather than the old one.
    const { options } = await resolveCategory(stop.spec, { prev, next })
    updated[i] = { ...stop, options }
  }

  return updated
}

/** Walking distance from a candidate to the stop it's being chosen for. */
export function distanceToAnchor(poi: Poi, anchor: { lat: number; lon: number }): number {
  return distanceM(poi.lat, poi.lon, anchor.lat, anchor.lon)
}
