import type { Fix } from '../types'

/**
 * Geolocation.
 *
 * This used to round every reading to three decimal places — about 110m at
 * Mumbai's latitude — as a privacy measure. That is the wrong trade for what
 * this app now is: a blue dot that can be a block away from you is not a blue
 * dot, it is a guess, and "find the chai place I'm standing outside" stops
 * working. Readings are now reported as the device gives them, and the
 * accuracy the device reports travels with them so the map can draw the real
 * uncertainty instead of a made-up constant.
 *
 * Still true: the fix lives in a module variable, never in localStorage,
 * sessionStorage, IndexedDB or a cookie, and nothing in this file transmits
 * anything. Closing the tab forgets it.
 */

/** Fallback when a device reports no accuracy at all, which some desktops do. */
const ASSUMED_ACCURACY_M = 50

let lastFix: Fix | null = null

export function getCachedFix(): Fix | null {
  return lastFix
}

export function forgetFix(): void {
  lastFix = null
}

export class GeoError extends Error {
  constructor(
    message: string,
    /** Whether prompting again could plausibly succeed. */
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'GeoError'
  }
}

/**
 * Ask the browser for a position. Must be called from a user gesture handler.
 * Resolves with an already-rounded fix.
 */
export function requestFix(options?: { timeoutMs?: number }): Promise<Fix> {
  const timeoutMs = options?.timeoutMs ?? 10_000

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('This browser has no location support.', false))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: Fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precisionM: Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : ASSUMED_ACCURACY_M,
        }
        lastFix = fix
        resolve(fix)
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(
              new GeoError(
                'Location permission was denied. You can still search by naming an area, like "Andheri East".',
                false
              )
            )
            break
          case err.POSITION_UNAVAILABLE:
            reject(new GeoError('Could not get a location fix right now.', true))
            break
          case err.TIMEOUT:
            reject(new GeoError('Location request timed out.', true))
            break
          default:
            reject(new GeoError('Location failed.', true))
        }
      },
      {
        // Worth the battery: this is what draws the dot, and a coarse network
        // fix in a dense city can be several hundred metres out.
        enableHighAccuracy: true,
        timeout: timeoutMs,
        // A minute-old fix is fine to show instantly, and the watcher refines
        // it — but not so stale that it points at the last neighbourhood.
        maximumAge: 30_000,
      }
    )
  })
}

/**
 * Whether we can even ask without showing a prompt — used to label the button
 * honestly ("Use my location" vs "Allow location"). Never triggers a prompt.
 */
export async function permissionState(): Promise<PermissionState | 'unsupported'> {
  if (!('permissions' in navigator)) return 'unsupported'
  try {
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName,
    })
    return status.state
  } catch {
    return 'unsupported'
  }
}

// ---------------------------------------------------------------------------
// Navigation: precise, continuous position
// ---------------------------------------------------------------------------

/**
 * A live position while navigating.
 *
 * Navigation genuinely needs full precision — a route drawn to a 110m-rounded
 * point starts in the wrong street. So this deliberately does NOT round, which
 * is a real departure from the rest of this module.
 *
 * What still holds: the precise position never leaves the device except as the
 * start coordinate of a routing request the user explicitly triggered, and it
 * is never written to storage. Watching stops the moment navigation ends.
 */
export interface LiveFix {
  lat: number
  lon: number
  /** Metres of GPS uncertainty, straight from the device. */
  accuracyM: number
  /** Degrees clockwise from north, when the device reports it. */
  heading: number | null
  speedMps: number | null
  at: number
}

export type StopWatching = () => void

/**
 * Follow the device's position until the returned function is called.
 * Callers MUST call it — an abandoned watch keeps the GPS awake.
 */
export function watchLive(
  onFix: (fix: LiveFix) => void,
  onError?: (err: GeoError) => void
): StopWatching {
  if (!('geolocation' in navigator)) {
    onError?.(new GeoError('This browser has no location support.', false))
    return () => {}
  }

  const id = navigator.geolocation.watchPosition(
    (pos) => {
      onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        speedMps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
        at: pos.timestamp,
      })
    },
    (err) => {
      onError?.(
        new GeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied, so navigation cannot follow you."
            : 'Lost the location signal.',
          err.code !== err.PERMISSION_DENIED
        )
      )
    },
    {
      // Navigation is the one case that justifies the battery cost.
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15_000,
    }
  )

  return () => navigator.geolocation.clearWatch(id)
}

/** A single precise reading, for starting a route from where you actually are. */
export function requestPreciseFix(timeoutMs = 12_000): Promise<LiveFix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('This browser has no location support.', false))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          speedMps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
          at: pos.timestamp,
        }),
      (err) =>
        reject(
          new GeoError(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied.'
              : 'Could not get a location fix.',
            err.code !== err.PERMISSION_DENIED
          )
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: timeoutMs }
    )
  })
}
