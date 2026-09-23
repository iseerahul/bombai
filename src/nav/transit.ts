import type { Poi, RouteResult } from '../types'
import { distanceM, loadCategory } from '../search/localIndex'
import { fetchRoute } from '../trip/routing'

/**
 * A public-transport plan, composed rather than routed.
 *
 * OpenRouteService has no transit profile, and Mumbai Metro and the suburban
 * rail publish no openly usable timetable. So instead of pretending to know
 * departures, this builds the shape of the journey people actually make:
 *
 *   walk to the nearest station → ride to the station nearest your destination
 *   → walk from there
 *
 * The two walks are real routed legs. The ride is a straight line between
 * stations with a distance-based time estimate, and everything downstream
 * labels it an estimate. That is the honest ceiling of what this data supports:
 * we know where the stations are, not when the trains run.
 */

/** Average door-to-door speed including dwell time. Deliberately conservative. */
const RIDE_MPS = 8.3 // ~30 km/h
/** Flat allowance for getting to a platform and waiting. */
const WAIT_S = 5 * 60
/** Below this, taking a train is slower than simply walking. */
const MIN_RIDE_M = 1500
/** Beyond this from a station, "take the metro" stops being sensible advice. */
const MAX_ACCESS_WALK_M = 2000

export interface TransitPlan extends RouteResult {
  transit: {
    boardName: string
    alightName: string
    rideDistanceM: number
    rideDurationS: number
    accessWalkM: number
    egressWalkM: number
  }
}

/** True when a plan carries transit detail. */
export function isTransitPlan(route: RouteResult): route is TransitPlan {
  return 'transit' in route
}

function nearestStation(
  stations: Poi[],
  lat: number,
  lon: number
): { poi: Poi; distanceM: number } | null {
  let best: { poi: Poi; distanceM: number } | null = null
  for (const poi of stations) {
    const d = distanceM(lat, lon, poi.lat, poi.lon)
    if (!best || d < best.distanceM) best = { poi, distanceM: d }
  }
  return best
}

export class TransitUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransitUnavailable'
  }
}

/**
 * Build a transit plan, or explain why one doesn't make sense.
 *
 * Throwing rather than silently falling back to walking matters: someone who
 * chose "public transport" should be told that walking is the better option
 * here, not handed a walking route labelled as transit.
 */
export async function planTransit(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number }
): Promise<TransitPlan> {
  const stations = await loadCategory('transit').catch(() => [] as Poi[])
  if (!stations.length) {
    throw new TransitUnavailable(
      'No station data is loaded. Run the data build, then try again.'
    )
  }

  const board = nearestStation(stations, origin.lat, origin.lon)
  const alight = nearestStation(stations, destination.lat, destination.lon)

  if (!board || !alight) {
    throw new TransitUnavailable('No stations found near this journey.')
  }

  if (board.poi.id === alight.poi.id) {
    throw new TransitUnavailable(
      'Both ends are closest to the same station — walking or a cab will be quicker.'
    )
  }

  if (board.distanceM > MAX_ACCESS_WALK_M || alight.distanceM > MAX_ACCESS_WALK_M) {
    throw new TransitUnavailable(
      'The nearest stations are too far from this journey to be worth it.'
    )
  }

  const rideDistanceM = distanceM(
    board.poi.lat,
    board.poi.lon,
    alight.poi.lat,
    alight.poi.lon
  )

  if (rideDistanceM < MIN_RIDE_M) {
    throw new TransitUnavailable(
      'These stations are barely apart — walking will be faster than waiting.'
    )
  }

  // The two walks are genuine routed legs; only the ride is approximated.
  const [accessWalk, egressWalk] = await Promise.all([
    fetchRoute(
      [origin, { lat: board.poi.lat, lon: board.poi.lon }],
      'walk'
    ),
    fetchRoute(
      [{ lat: alight.poi.lat, lon: alight.poi.lon }, destination],
      'walk'
    ),
  ])

  const rideDurationS = Math.round(rideDistanceM / RIDE_MPS) + WAIT_S

  const coordinates: [number, number][] = [
    ...accessWalk.coordinates,
    [alight.poi.lon, alight.poi.lat],
    ...egressWalk.coordinates,
  ]

  return {
    coordinates,
    distanceM: Math.round(
      accessWalk.distanceM + rideDistanceM + egressWalk.distanceM
    ),
    durationS: Math.round(
      accessWalk.durationS + rideDurationS + egressWalk.durationS
    ),
    legs: [
      { distanceM: accessWalk.distanceM, durationS: accessWalk.durationS },
      { distanceM: Math.round(rideDistanceM), durationS: rideDurationS },
      { distanceM: egressWalk.distanceM, durationS: egressWalk.durationS },
    ],
    profile: 'transit',
    // Always true: the ride portion is never a real routed path, and the times
    // are estimates rather than a timetable.
    approximate: true,
    transit: {
      boardName: board.poi.name ?? 'Nearest station',
      alightName: alight.poi.name ?? 'Nearest station',
      rideDistanceM: Math.round(rideDistanceM),
      rideDurationS,
      accessWalkM: accessWalk.distanceM,
      egressWalkM: egressWalk.distanceM,
    },
  }
}
