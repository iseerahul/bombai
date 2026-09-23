/**
 * Shared Worker helpers.
 *
 * Extracted from index.ts once hangouts needed the same response shaping,
 * rate limiting and coordinate validation. One copy, so a fix to the
 * pseudonymous rate-limit scheme can't apply to half the endpoints.
 */

export interface Env {
  DB: D1Database
  /**
   * Photo bucket. Optional so the app still runs without it configured —
   * uploads return 503 rather than the whole Worker failing to boot.
   */
  PHOTOS?: R2Bucket
  /** Random secret; `wrangler secret put IP_SALT`. Rotating it resets all buckets. */
  IP_SALT: string
  /**
   * OpenRouteService key for /api/route. Optional — without it routing is
   * disabled and the client falls back to straight lines between stops.
   */
  ORS_API_KEY?: string

  // --- hangout app (Google sign-in) ---
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /**
   * Where the BROWSER is, e.g. http://localhost:5173 in development.
   * The Worker sits behind Vite's proxy in dev, so its own request origin is
   * not the origin Google must redirect back to.
   */
  APP_ORIGIN?: string
  /** '1' switches off the dev sign-in shortcut regardless of anything else. */
  DEV_LOGIN_DISABLED?: string

  /**
   * Ticketmaster Discovery API key for the Events source. Optional — without
   * it, events come only from members and the curated seed.
   */
  TICKETMASTER_API_KEY?: string
}

/** Greater Mumbai, plus slack. Requests outside it are rejected as bad input. */
export const SERVICE_BBOX = { south: 18.8, west: 72.7, north: 19.4, east: 73.1 }

export function corsHeaders(): Record<string, string> {
  return {
    // In production the app is same-origin. This exists so `wrangler dev` works
    // alongside the Vite dev server.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Profile-Id, X-Profile-Secret, X-Profile-Name',
    'Access-Control-Max-Age': '86400',
  }
}

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(),
      ...extraHeaders,
    },
  })
}

/**
 * Pseudonymous rate-limit bucket.
 *
 * The IP is hashed with a server secret plus the current UTC date. Because the
 * date is inside the hash, the same visitor produces a different bucket
 * tomorrow, so these rows cannot build a history of anyone. The raw IP is never
 * written anywhere.
 */
export async function rateBucket(
  request: Request,
  env: Env,
  scope: string
): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0'
  const day = new Date().toISOString().slice(0, 10)
  const data = new TextEncoder().encode(`${env.IP_SALT}|${day}|${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${scope}:${hex}`
}

export async function checkRateLimit(
  env: Env,
  bucket: string,
  limit: { max: number; windowMs: number }
): Promise<{ ok: boolean; retryAfterS: number }> {
  const now = Date.now()
  const windowStart = now - (now % limit.windowMs)

  const row = await env.DB.prepare(
    'SELECT count, window_start FROM rate_limits WHERE bucket = ?'
  )
    .bind(bucket)
    .first<{ count: number; window_start: number }>()

  if (!row || row.window_start !== windowStart) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start`
    )
      .bind(bucket, windowStart)
      .run()
    return { ok: true, retryAfterS: 0 }
  }

  if (row.count >= limit.max) {
    return {
      ok: false,
      retryAfterS: Math.ceil((windowStart + limit.windowMs - now) / 1000),
    }
  }

  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?')
    .bind(bucket)
    .run()
  return { ok: true, retryAfterS: 0 }
}

export function isFiniteLat(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -90 && n <= 90
}

export function isFiniteLon(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180
}

export function inServiceArea(lat: number, lon: number): boolean {
  return (
    lat >= SERVICE_BBOX.south &&
    lat <= SERVICE_BBOX.north &&
    lon >= SERVICE_BBOX.west &&
    lon <= SERVICE_BBOX.east
  )
}

/** Round to ~110m. Used wherever a coordinate is about a place, not a person. */
export function roundCoord(n: number): number {
  return Number(n.toFixed(3))
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
