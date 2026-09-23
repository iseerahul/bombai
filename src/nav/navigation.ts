import type { RouteResult } from '../types'
import type { LiveFix } from '../privacy/geo'
import { distanceM } from '../search/localIndex'
import { type TravelMode, fetchRoute } from '../trip/routing'
import { planTransit } from './transit'

/**
 * Turn-by-turn-ish navigation.
 *
 * Not full turn-by-turn: there are no spoken instructions and no manoeuvre
 * list, because OpenRouteService's free tier gives us geometry and durations
 * rather than a guidance stream we could speak reliably. What this does give
 * you is the thing people actually use — a line to follow, how far is left, when
 * you'll arrive, and a recalculation when you wander off it.
 *
 * All the geometry below runs on the device. The only network call is the
 * route request itself.
 */

export interface NavPlace {
  id: string
  name: string
  lat: number
  lon: number
}

export interface NavState {
  mode: TravelMode
  /** Where you're heading. The last entry of the itinerary. */
  destination: NavPlace
  /** Stops before it, in travel order. */
  waypoints: NavPlace[]
  route: RouteResult
  fix: LiveFix | null
  remainingM: number
  remainingS: number
  /** True when you've strayed far enough that the line no longer helps. */
  offRoute: boolean
  arrived: boolean
  recalculating: boolean
  error: string | null
}

/** Off-route beyond this, and the route is worth recomputing. */
const OFF_ROUTE_M = 45
/** Within this of the destination, call it arrived. Wider when driving. */
const ARRIVED_M = 30
const ARRIVED_DRIVING_M = 60
/** Fallback pace when a route carries no duration. */
const WALK_M_PER_S = 1.35

/** Metres from a point to the segment a–b, using a local flat-earth approximation. */
function pointToSegmentM(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  // Over a few hundred metres, scaling longitude by cos(lat) makes plane
  // geometry accurate enough and far cheaper than repeated haversines.
  const latScale = 111_320
  const lonScale = 111_320 * Math.cos((pLat * Math.PI) / 180)

  const px = pLon * lonScale
  const py = pLat * latScale
  const ax = aLon * lonScale
  const ay = aLat * latScale
  const bx = bLon * lonScale
  const by = bLat * latScale

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) return Math.hypot(px - ax, py - ay)

  // Projection parameter, clamped so we measure to the segment, not the line.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

interface Projection {
  /** Index of the segment start you're nearest to. */
  index: number
  distanceM: number
}

/** Where along the route you currently are. */
function projectOntoRoute(fix: LiveFix, coords: [number, number][]): Projection {
  let best: Projection = { index: 0, distanceM: Number.POSITIVE_INFINITY }

  for (let i = 0; i < coords.length - 1; i++) {
    const [aLon, aLat] = coords[i]
    const [bLon, bLat] = coords[i + 1]
    const d = pointToSegmentM(fix.lat, fix.lon, aLat, aLon, bLat, bLon)
    if (d < best.distanceM) best = { index: i, distanceM: d }
  }

  return best
}

/** Metres of route still ahead of you, from the projection onward. */
function remainingAlong(
  fix: LiveFix,
  coords: [number, number][],
  fromIndex: number
): number {
  if (coords.length < 2) return 0

  // From where you are to the end of the segment you're on...
  const [nextLon, nextLat] = coords[Math.min(fromIndex + 1, coords.length - 1)]
  let total = distanceM(fix.lat, fix.lon, nextLat, nextLon)

  // ...then every segment after it.
  for (let i = fromIndex + 1; i < coords.length - 1; i++) {
    const [aLon, aLat] = coords[i]
    const [bLon, bLat] = coords[i + 1]
    total += distanceM(aLat, aLon, bLat, bLon)
  }

  return total
}

/**
 * Recompute progress against the current route.
 * Pure and local — call it on every position update.
 */
export function advance(state: NavState, fix: LiveFix): NavState {
  const coords = state.route.coordinates
  if (coords.length < 2) return { ...state, fix }

  const projection = projectOntoRoute(fix, coords)
  const remainingM = Math.round(remainingAlong(fix, coords, projection.index))

  // Scale the route's own duration by how much is left, so the ETA reflects the
  // routing engine's pace rather than a guess.
  const ratio = state.route.distanceM > 0 ? remainingM / state.route.distanceM : 0
  const remainingS = state.route.durationS
    ? Math.round(state.route.durationS * ratio)
    : Math.round(remainingM / WALK_M_PER_S)

  const straightToEnd = distanceM(
    fix.lat,
    fix.lon,
    state.destination.lat,
    state.destination.lon
  )

  return {
    ...state,
    fix,
    remainingM,
    remainingS,
    // GPS error shouldn't read as "you're off route", so the threshold grows
    // with the reported accuracy.
    offRoute: projection.distanceM > Math.max(OFF_ROUTE_M, fix.accuracyM),
    arrived:
      straightToEnd <= (state.mode === 'drive' ? ARRIVED_DRIVING_M : ARRIVED_M),
  }
}

/** Build a fresh route from where you are through any stops to the destination. */
export async function planFrom(
  fix: LiveFix,
  waypoints: NavPlace[],
  destination: NavPlace,
  mode: TravelMode = 'walk'
): Promise<RouteResult> {
  // Transit is composed from walk legs plus a rail hop, and only supports a
  // single origin-destination pair — via-points don't map onto a train journey.
  if (mode === 'transit') {
    return planTransit(
      { lat: fix.lat, lon: fix.lon },
      { lat: destination.lat, lon: destination.lon }
    )
  }

  const points = [
    { lat: fix.lat, lon: fix.lon },
    ...waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
    { lat: destination.lat, lon: destination.lon },
  ]
  return fetchRoute(points, mode)
}

export async function startNavigation(
  fix: LiveFix,
  destination: NavPlace,
  waypoints: NavPlace[] = [],
  mode: TravelMode = 'walk'
): Promise<NavState> {
  const route = await planFrom(fix, waypoints, destination, mode)

  const base: NavState = {
    mode,
    destination,
    waypoints,
    route,
    fix,
    remainingM: route.distanceM,
    remainingS: route.durationS,
    offRoute: false,
    arrived: false,
    recalculating: false,
    error: null,
  }

  return advance(base, fix)
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`
}

export function formatEta(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60))
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Clock time of arrival, which is what people actually plan around. */
export function arrivalClock(seconds: number, now = Date.now()): string {
  return new Date(now + seconds * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}
