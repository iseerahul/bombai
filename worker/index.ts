/**
 * Cloudflare Worker — the app's only server component.
 *
 * It exists for the things a browser cannot do on its own:
 *   1. To hold the OpenRouteService key and proxy routing — the one feature
 *      that genuinely needs the user's coordinates.
 *   2. To store community reports, accounts and activities, which are
 *      inherently shared state.
 *   3. To reach OpenStreetMap's geocoders for names the baked corpus doesn't
 *      hold, behind one identifying User-Agent and a shared cache.
 *
 * Search is NOT here. It runs entirely on-device against the GeoJSON the
 * client already downloaded — see src/search/rank.ts. An earlier version sent
 * the question to Gemini through this Worker; that endpoint and its key are
 * gone.
 *
 * What it deliberately does NOT do: log request bodies, set cookies, issue
 * identifiers, or store IP addresses. Rate limiting uses a salted hash whose
 * salt rotates daily, so yesterday's buckets cannot be linked to today's.
 */

import {
  type Env,
  SERVICE_BBOX,
  checkRateLimit,
  corsHeaders,
  isFiniteLat,
  isFiniteLon,
  json,
  rateBucket,
  roundCoord,
} from './lib'
import { routeHangouts, sweepHangouts } from './hangouts'
import { routeAuth, sweepSessions } from './auth'
import { routeSocial, sweepSocial } from './social'
import { routeRooms, sweepRooms } from './rooms'
import { routeEvents, sweepEvents } from './events'
import { routeGeocode } from './geocode'
import { routeBoard } from './board'
import { routeDestinations } from './destinations'

export type { Env }

/** Report lifetimes. Flooding is short by design — see the note in handleCreateReport. */
const TTL_MS = {
  flooded: 8 * 60 * 60 * 1000,
  clear: 8 * 60 * 60 * 1000,
  working: 30 * 24 * 60 * 60 * 1000,
  broken: 30 * 24 * 60 * 60 * 1000,
  closed: 30 * 24 * 60 * 60 * 1000,
} as const

type ReportKind = keyof typeof TTL_MS

const RATE_LIMITS = {
  report: { max: 20, windowMs: 60 * 60 * 1000 },
  vote: { max: 100, windowMs: 60 * 60 * 1000 },
  // ORS free tier is 2,000/day overall, so keep any one visitor well under it.
  route: { max: 60, windowMs: 60 * 60 * 1000 },
} as const

// ---------------------------------------------------------------------------
// /api/route  — walking directions via OpenRouteService
// ---------------------------------------------------------------------------

/**
 * The one endpoint that genuinely receives user coordinates.
 *
 * Everything else in this app searches on-device precisely so locations never
 * travel. Routing cannot work that way — the road graph is far too large to
 * ship to a phone — so this is a deliberate, disclosed exception. What we can
 * still control, and do:
 *   - ORS never sees the visitor's IP; it only ever talks to this Worker.
 *   - No identifier is attached, and consecutive trips are unlinkable.
 *   - Coordinates are never written to the database or logged.
 *   - It is only ever called when someone explicitly plans a trip.
 *
 * The privacy dialog states this plainly. Do not weaken that wording.
 */
async function handleRoute(request: Request, env: Env): Promise<Response> {
  if (!env.ORS_API_KEY) {
    // Explicit, so the client can fall back to straight lines and say why.
    return json({ error: 'routing_not_configured' }, 503)
  }

  const bucket = await rateBucket(request, env, 'route')
  const limit = await checkRateLimit(env, bucket, RATE_LIMITS.route)
  if (!limit.ok) {
    return json({ error: 'rate_limited' }, 429, {
      'Retry-After': String(limit.retryAfterS),
    })
  }

  let body: { coordinates?: unknown; profile?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const raw = body.coordinates
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 10) {
    return json({ error: 'need_2_to_10_coordinates' }, 400)
  }

  const coordinates: [number, number][] = []
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      return json({ error: 'bad_coordinate_pair' }, 400)
    }
    const [lon, lat] = pair.map(Number)
    if (!isFiniteLat(lat) || !isFiniteLon(lon)) {
      return json({ error: 'bad_coordinate_values' }, 400)
    }
    // Keep this a Mumbai app: refuse anything outside the served area rather
    // than spending the shared ORS quota on arbitrary world routes.
    if (
      lat < SERVICE_BBOX.south ||
      lat > SERVICE_BBOX.north ||
      lon < SERVICE_BBOX.west ||
      lon > SERVICE_BBOX.east
    ) {
      return json({ error: 'outside_service_area' }, 400)
    }
    coordinates.push([lon, lat])
  }

  /*
   * OpenRouteService profiles we expose. Public transport is deliberately NOT
   * here: ORS has no transit profile, and Mumbai publishes no open timetable,
   * so a "transit" route is composed client-side from walk legs plus the rail
   * network and labelled as an estimate. See src/nav/transit.ts.
   */
  const PROFILES = ['foot-walking', 'driving-car', 'cycling-regular'] as const
  const profile = (PROFILES as readonly string[]).includes(String(body.profile))
    ? String(body.profile)
    : 'foot-walking'

  let res: Response
  try {
    res = await fetch(
      `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
      {
        method: 'POST',
        headers: {
          Authorization: env.ORS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ coordinates, instructions: false }),
        signal: AbortSignal.timeout(20_000),
      }
    )
  } catch {
    return json({ error: 'routing_unreachable' }, 502)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const errBody = (await res.json()) as { error?: { message?: string } | string }
      detail =
        typeof errBody.error === 'string'
          ? errBody.error
          : (errBody.error?.message ?? '')
    } catch {
      /* body wasn't JSON; the status alone is enough to act on */
    }
    // 2010 = "no route found near given coordinate", which is a normal outcome
    // for a pin in the middle of a block, not a server failure.
    const status = res.status === 429 ? 429 : res.status === 404 ? 404 : 502
    return json({ error: 'routing_failed', status: res.status, detail }, status)
  }

  const geo = (await res.json()) as {
    features?: {
      geometry?: { coordinates?: [number, number][] }
      properties?: {
        summary?: { distance?: number; duration?: number }
        segments?: { distance?: number; duration?: number }[]
      }
    }[]
  }

  const feature = geo.features?.[0]
  if (!feature?.geometry?.coordinates?.length) {
    return json({ error: 'empty_route' }, 502)
  }

  // Return only what the map needs. ORS responses carry a lot of extra detail.
  return json({
    coordinates: feature.geometry.coordinates,
    distanceM: Math.round(feature.properties?.summary?.distance ?? 0),
    durationS: Math.round(feature.properties?.summary?.duration ?? 0),
    legs: (feature.properties?.segments ?? []).map((s) => ({
      distanceM: Math.round(s.distance ?? 0),
      durationS: Math.round(s.duration ?? 0),
    })),
    profile,
  })
}

// ---------------------------------------------------------------------------
// /api/reports
// ---------------------------------------------------------------------------

async function handleListReports(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const bbox = url.searchParams.get('bbox')

  let south = -90
  let west = -180
  let north = 90
  let east = 180

  if (bbox) {
    const parts = bbox.split(',').map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return json({ error: 'bad_bbox' }, 400)
    }
    ;[south, west, north, east] = parts
  }

  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT id, poi_id, lat, lon, kind, depth, note, created_at, expires_at, up, down
       FROM reports
      WHERE expires_at > ?
        AND lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
      ORDER BY created_at DESC
      LIMIT 1000`
  )
    .bind(now, south, north, west, east)
    .all()

  return json({ reports: results ?? [], now })
}

async function handleCreateReport(request: Request, env: Env): Promise<Response> {
  const bucket = await rateBucket(request, env, 'report')
  const limit = await checkRateLimit(env, bucket, RATE_LIMITS.report)
  if (!limit.ok) {
    return json({ error: 'rate_limited' }, 429, {
      'Retry-After': String(limit.retryAfterS),
    })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const kind = body.kind as ReportKind
  if (!kind || !(kind in TTL_MS)) return json({ error: 'bad_kind' }, 400)

  if (!isFiniteLat(body.lat) || !isFiniteLon(body.lon)) {
    return json({ error: 'bad_coords' }, 400)
  }

  const depth =
    kind === 'flooded' && ['ankle', 'knee', 'waist'].includes(String(body.depth))
      ? String(body.depth)
      : null

  const poiId =
    typeof body.poi_id === 'string' && body.poi_id.length <= 64 ? body.poi_id : null

  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 200)
      : null

  const now = Date.now()
  // Flooding expires in hours, infrastructure in weeks. A monsoon map showing
  // yesterday's water is more dangerous than a map showing nothing, because a
  // stale "clear" reads as an all-clear.
  const expiresAt = now + TTL_MS[kind]
  const id = crypto.randomUUID()

  await env.DB.prepare(
    `INSERT INTO reports
       (id, poi_id, lat, lon, kind, depth, note, created_at, expires_at, up, down)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
  )
    .bind(
      id,
      poiId,
      roundCoord(body.lat),
      roundCoord(body.lon),
      kind,
      depth,
      note,
      now,
      expiresAt
    )
    .run()

  return json({ id, created_at: now, expires_at: expiresAt }, 201)
}

async function handleVote(
  request: Request,
  env: Env,
  reportId: string
): Promise<Response> {
  const bucket = await rateBucket(request, env, 'vote')
  const limit = await checkRateLimit(env, bucket, RATE_LIMITS.vote)
  if (!limit.ok) {
    return json({ error: 'rate_limited' }, 429, {
      'Retry-After': String(limit.retryAfterS),
    })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const direction = body.direction === 'down' ? 'down' : 'up'
  const column = direction === 'up' ? 'up' : 'down'

  const result = await env.DB.prepare(
    `UPDATE reports SET ${column} = ${column} + 1 WHERE id = ? AND expires_at > ?`
  )
    .bind(reportId, Date.now())
    .run()

  if (!result.meta.changes) return json({ error: 'not_found_or_expired' }, 404)

  const row = await env.DB.prepare('SELECT up, down FROM reports WHERE id = ?')
    .bind(reportId)
    .first<{ up: number; down: number }>()

  return json({ id: reportId, ...row })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    try {
      // Each of these owns one path prefix and returns null for anything else,
      // so they can sit first without shadowing the routes below.
      const auth = await routeAuth(request, env, url)
      if (auth) return auth

      const social = await routeSocial(request, env, url)
      if (social) return social

      const rooms = await routeRooms(request, env, url)
      if (rooms) return rooms

      const events = await routeEvents(request, env, url)
      if (events) return events

      const hangout = await routeHangouts(request, env, url)
      if (hangout) return hangout

      if (url.pathname === '/api/route' && request.method === 'POST') {
        return await handleRoute(request, env)
      }

      if (url.pathname === '/api/reports') {
        if (request.method === 'GET') return await handleListReports(request, env)
        if (request.method === 'POST') return await handleCreateReport(request, env)
      }

      const voteMatch = url.pathname.match(/^\/api\/reports\/([\w-]+)\/vote$/)
      if (voteMatch && request.method === 'POST') {
        return await handleVote(request, env, voteMatch[1])
      }

      const geo = await routeGeocode(request, env, url)
      if (geo) return geo

      const board = await routeBoard(request, env, url)
      if (board) return board

      const destinations = await routeDestinations(request, env, url)
      if (destinations) return destinations

      /*
       * Public counts for the landing page.
       *
       * It used to print "42 plans live · 2.4K city people", and both numbers
       * were invented. A landing page that opens with a fabricated figure is
       * the first thing a visitor can check and catch you on, and this app's
       * whole pitch is that it says what it does not know.
       *
       * So these are real rows, and small numbers are shown as they are. No
       * auth: they are aggregates, nothing here identifies anyone.
       */
      if (url.pathname === '/api/stats') {
        const now = Date.now()
        const one = async (sql: string, ...bind: unknown[]) => {
          const row = await env.DB.prepare(sql)
            .bind(...bind)
            .first<{ n: number }>()
          return row?.n ?? 0
        }

        const [members, live, activities, events, spots] = await Promise.all([
          one('SELECT COUNT(*) AS n FROM users'),
          /*
           * People on the map this minute. Same predicate listPeople uses, so
           * the number matches what someone actually sees: not expired, and
           * sharing switched on. Presence rows are deleted outright when
           * sharing stops, so this cannot count anyone who has left.
           */
          one(
            'SELECT COUNT(*) AS n FROM presence WHERE expires_at > ? AND visible = 1',
            now
          ),
          one('SELECT COUNT(*) AS n FROM activities WHERE expires_at > ?', now),
          one('SELECT COUNT(*) AS n FROM events WHERE expires_at > ?', now),
          one("SELECT COUNT(*) AS n FROM spots WHERE status = 'visible'"),
        ])

        return json(
          {
            // Things you could turn up to right now.
            plans: activities + events,
            activities,
            events,
            // People with an account. Not "visitors" — we do not track those.
            members,
            // Of those, the ones on the map right now.
            live,
            // Places added by people, on top of the baked OpenStreetMap set.
            spots,
          },
          200,
          // A minute of cache: the landing is static and every visitor hits
          // this, but the numbers only need to be roughly current.
          { 'Cache-Control': 'public, max-age=60' }
        )
      }

      if (url.pathname === '/api/health') {
        // `routing` lets the client disable trip planning up front rather than
        // offering it and failing at the moment someone tries to use it.
        return json({ ok: true, routing: Boolean(env.ORS_API_KEY) })
      }

      return json({ error: 'not_found' }, 404)
    } catch (err) {
      // Log the message only. Never log request bodies — they carry report
      // notes, messages and coordinates, none of which we promised to keep.
      console.error('worker error:', (err as Error).message)
      return json({ error: 'internal_error' }, 500)
    }
  },

  /** Cron-triggered sweep so expired rows don't accumulate. */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = Date.now()
    await env.DB.prepare('DELETE FROM reports WHERE expires_at < ?').bind(now).run()
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(now - 24 * 60 * 60 * 1000)
      .run()
    // Activities take their roster and their whole chat with them when they go.
    await sweepHangouts(env)
    await sweepSessions(env)
    await sweepSocial(env)
    await sweepRooms(env)
    await sweepEvents(env)
  },
}
