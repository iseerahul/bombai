import type { RouteResult } from '../types'
import { distanceM } from '../search/localIndex'

/**
 * Walking route client.
 *
 * This is the ONE place in the app that sends coordinates off the device.
 * Everything else searches locally. Keep it that way: if you find yourself
 * wanting to call this to answer a search, you've taken a wrong turn.
 *
 * The Worker proxies to OpenRouteService so the provider never sees the
 * visitor's IP, and nothing here is stored.
 */

/** Travel modes offered to the user. */
export type TravelMode = 'walk' | 'drive' | 'cycle' | 'transit'

/** ORS profile for each mode. Transit is composed separately, not routed. */
export const ORS_PROFILE: Record<Exclude<TravelMode, 'transit'>, string> = {
  walk: 'foot-walking',
  drive: 'driving-car',
  cycle: 'cycling-regular',
}

/** Straight-line fallback speeds, per mode. */
const FALLBACK_MPS: Record<TravelMode, number> = {
  walk: 1.35,
  drive: 8.3, // ~30 km/h, which is optimistic for Mumbai traffic
  cycle: 4.2,
  transit: 7,
}

let routingAvailable: boolean | null = null

/** Ask the Worker once whether routing is configured, and remember the answer. */
export async function isRoutingAvailable(): Promise<boolean> {
  if (routingAvailable !== null) return routingAvailable
  try {
    const res = await fetch('/api/health')
    if (!res.ok) {
      routingAvailable = false
      return false
    }
    const data = (await res.json()) as { routing?: boolean }
    routingAvailable = Boolean(data.routing)
  } catch {
    routingAvailable = false
  }
  return routingAvailable
}

/**
 * Straight lines between stops, used when routing is unavailable.
 *
 * Flagged `approximate` so the UI can say so. A straight line across Mumbai is
 * not a walkable path, and presenting it as one would be a lie about distance,
 * time and — during monsoon — safety.
 */
function straightLineRoute(
  points: { lat: number; lon: number }[],
  mode: TravelMode = 'walk'
): RouteResult {
  const coordinates = points.map((p) => [p.lon, p.lat] as [number, number])

  const speed = FALLBACK_MPS[mode]
  const legs = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = distanceM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
    total += d
    legs.push({ distanceM: Math.round(d), durationS: Math.round(d / speed) })
  }

  return {
    coordinates,
    distanceM: Math.round(total),
    durationS: Math.round(total / speed),
    legs,
    profile: 'straight-line',
    approximate: true,
  }
}

export class RoutingError extends Error {
  constructor(
    message: string,
    readonly kind: 'unconfigured' | 'no_route' | 'rate_limited' | 'failed'
  ) {
    super(message)
    this.name = 'RoutingError'
  }
}

/**
 * Fetch a walking route through the given points in order.
 * Falls back to straight lines rather than failing the whole trip.
 */
export async function fetchRoute(
  points: { lat: number; lon: number }[],
  mode: Exclude<TravelMode, 'transit'> = 'walk'
): Promise<RouteResult> {
  if (points.length < 2) {
    throw new RoutingError('A route needs at least two stops.', 'failed')
  }

  // ORS accepts up to 10 waypoints per request, which is well beyond any
  // realistic errand chain.
  if (points.length > 10) {
    throw new RoutingError('Too many stops — 10 is the maximum.', 'failed')
  }

  let res: Response
  try {
    res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: points.map((p) => [p.lon, p.lat]),
        profile: ORS_PROFILE[mode],
      }),
    })
  } catch {
    return straightLineRoute(points, mode)
  }

  if (res.status === 503) {
    // No ORS key configured. Degrade rather than block the feature.
    routingAvailable = false
    return straightLineRoute(points, mode)
  }

  if (res.status === 429) {
    throw new RoutingError(
      'Routing quota reached for now. Try again shortly.',
      'rate_limited'
    )
  }

  if (res.status === 404) {
    throw new RoutingError(
      "Couldn't find a walking path between those stops.",
      'no_route'
    )
  }

  if (!res.ok) return straightLineRoute(points, mode)

  const data = (await res.json()) as RouteResult
  if (!data.coordinates?.length) return straightLineRoute(points, mode)
  return data
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
