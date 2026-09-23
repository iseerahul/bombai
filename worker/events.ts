/**
 * Events — what's on in Mumbai, free and paid.
 *
 * There is no free, legal API that aggregates every event in a city.
 * Eventbrite removed public event search in 2020, Meetup's API is paid, and
 * BookMyShow and Insider have no public API and forbid scraping. So instead of
 * pretending to be comprehensive, this is a **pluggable source layer**:
 *
 *   community    — posted by a member here
 *   ticketmaster — Ticketmaster Discovery API (free key, partial India coverage)
 *   seed         — a curated file of known Mumbai venues and recurring nights
 *
 * Every event carries its source, and the UI shows it, so a member's post is
 * never mistaken for a verified listing. Adding a real aggregator later means
 * writing one adapter, not rewriting this.
 */

import { type Env, checkRateLimit, inServiceArea, isFiniteLat, isFiniteLon, json, rateBucket } from './lib'
import { type User, currentUser, requireUser } from './auth'
import { ensureRoom, joinRoom } from './rooms'
import { seedEvents } from './seed-events'
import { refreshLuma } from './luma'
import { refreshAllEvents } from './allevents'

const LIMITS = {
  create: { max: 10, windowMs: 60 * 60 * 1000 },
  refresh: { max: 6, windowMs: 60 * 60 * 1000 },
} as const

export const EVENT_CATEGORIES = [
  'nightlife',
  'music',
  'festival',
  'comedy',
  'arts',
  'food',
  'outdoors',
  'wellness',
  'sport',
  'tech',
  'community',
  'other',
] as const

/** Events linger a day past their end so "was that last night?" still resolves. */
const GRACE_MS = 24 * 60 * 60 * 1000

const CATEGORY_EMOJI: Record<string, string> = {
  nightlife: '🕺',
  festival: '🎇',
  outdoors: '🏕️',
  wellness: '🧘',
  tech: '💻',
  community: '👥',
  music: '🎵',
  sport: '🏟️',
  arts: '🎭',
  comedy: '🎤',
  food: '🍽️',
  other: '🎫',
}

/** Every imported source needs the same emoji lookup, so it is shared. */
function emojiFor(category: string): string {
  return CATEGORY_EMOJI[category] ?? '🎫'
}

interface EventRow {
  id: string
  source: string
  external_id: string | null
  creator_id: string | null
  title: string
  description: string | null
  category: string | null
  emoji: string | null
  venue_name: string
  address: string | null
  lat: number
  lon: number
  starts_at: number
  ends_at: number | null
  time_known: number | null
  price_min: number | null
  price_max: number | null
  currency: string | null
  ticket_url: string | null
  image_url: string | null
}

function shape(row: EventRow, going: number, joined: boolean, roomId: string | null) {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    description: row.description,
    category: row.category ?? 'other',
    emoji: row.emoji ?? CATEGORY_EMOJI[row.category ?? 'other'] ?? '🎫',
    venueName: row.venue_name,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    // false only when a source gave a date with no clock time.
    timeKnown: row.time_known !== 0,
    // Paise in the database; rupees on the wire, because nothing downstream
    // wants to think about minor units.
    priceMin: row.price_min == null ? null : row.price_min / 100,
    priceMax: row.price_max == null ? null : row.price_max / 100,
    currency: row.currency ?? 'INR',
    isFree: row.price_min === 0,
    ticketUrl: row.ticket_url,
    imageUrl: row.image_url,
    isMine: false,
    going,
    joined,
    roomId,
  }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function listEvents(
  request: Request,
  env: Env,
  user: User | null
): Promise<Response> {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')
  const free = url.searchParams.get('free') === '1'

  const now = Date.now()
  const params: unknown[] = [now]
  let sql = 'SELECT * FROM events WHERE expires_at > ?'

  if (category && (EVENT_CATEGORIES as readonly string[]).includes(category)) {
    sql += ' AND category = ?'
    params.push(category)
  }
  if (free) sql += ' AND price_min = 0'

  /*
   * A specific day, as YYYY-MM-DD.
   *
   * Bounded in IST rather than UTC: someone picking "Friday" means Friday in
   * Mumbai, and a 19:30 gig would otherwise fall into the wrong day for any
   * server not sitting in +05:30.
   */
  const day = url.searchParams.get('date')
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const IST = 5.5 * 60 * 60 * 1000
    const startOfDay = Date.parse(`${day}T00:00:00Z`) - IST
    if (Number.isFinite(startOfDay)) {
      sql += ' AND starts_at >= ? AND starts_at < ?'
      params.push(startOfDay, startOfDay + 86_400_000)
    }
  }

  // Large enough that the unfiltered board is not silently truncated now that
  // two import sources feed it, small enough to stay a sane mobile payload.
  sql += ' ORDER BY starts_at ASC LIMIT 400'

  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all<EventRow>()

  const rows = results ?? []
  if (!rows.length) return json({ events: [], now })

  /*
   * Join against the live-events set rather than binding one placeholder per
   * id. SQLite caps how many variables a statement may carry, and with the
   * imported sources the board comfortably exceeds it — an `IN (?,?,?…)` over
   * 200 rows fails outright. These two queries take two binds regardless of
   * how large the board grows.
   */
  const { results: attendees } = await env.DB.prepare(
    `SELECT a.event_id, COUNT(*) AS going,
            SUM(CASE WHEN a.user_id = ? THEN 1 ELSE 0 END) AS is_mine
       FROM event_attendees a
       JOIN events e ON e.id = a.event_id
      WHERE e.expires_at > ?
      GROUP BY a.event_id`
  )
    .bind(user?.id ?? '', now)
    .all<{ event_id: string; going: number; is_mine: number }>()

  const going = new Map<string, number>()
  const mine = new Set<string>()
  for (const a of attendees ?? []) {
    going.set(a.event_id, a.going)
    if (a.is_mine > 0) mine.add(a.event_id)
  }

  const { results: rooms } = await env.DB.prepare(
    `SELECT r.ref_id, r.id FROM rooms r
       JOIN events e ON e.id = r.ref_id
      WHERE r.kind = 'event' AND e.expires_at > ?`
  )
    .bind(now)
    .all<{ ref_id: string; id: string }>()
  const roomByEvent = new Map((rooms ?? []).map((r) => [r.ref_id, r.id]))

  return json({
    now,
    events: rows.map((r) => ({
      ...shape(r, going.get(r.id) ?? 0, mine.has(r.id), roomByEvent.get(r.id) ?? null),
      isMine: Boolean(user && r.creator_id === user.id),
    })),
  })
}

async function eventDetail(
  env: Env,
  user: User | null,
  eventId: string
): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?')
    .bind(eventId)
    .first<EventRow>()
  if (!row) return json({ error: 'not_found' }, 404)

  const { results: attendees } = await env.DB.prepare(
    `SELECT a.user_id, u.name, u.avatar_url
       FROM event_attendees a JOIN users u ON u.id = a.user_id
      WHERE a.event_id = ? ORDER BY a.joined_at ASC LIMIT 100`
  )
    .bind(eventId)
    .all<{ user_id: string; name: string; avatar_url: string | null }>()

  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE kind = 'event' AND ref_id = ?"
  )
    .bind(eventId)
    .first<{ id: string }>()

  // Blocked people vanish from the attendee list, as everywhere else.
  let blocked = new Set<string>()
  if (user) {
    const { results } = await env.DB.prepare(
      `SELECT blocked_id AS other FROM blocks WHERE blocker_id = ?
       UNION SELECT blocker_id AS other FROM blocks WHERE blocked_id = ?`
    )
      .bind(user.id, user.id)
      .all<{ other: string }>()
    blocked = new Set((results ?? []).map((r) => r.other))
  }

  const visible = (attendees ?? []).filter((a) => !blocked.has(a.user_id))

  return json({
    ...shape(
      row,
      visible.length,
      Boolean(user && visible.some((a) => a.user_id === user.id)),
      room?.id ?? null
    ),
    isMine: Boolean(user && row.creator_id === user.id),
    attendees: visible.map((a) => ({
      id: a.user_id,
      name: a.name,
      avatarUrl: a.avatar_url,
    })),
  })
}

// ---------------------------------------------------------------------------
// Community events
// ---------------------------------------------------------------------------

async function createEvent(request: Request, env: Env, user: User): Promise<Response> {
  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'event-create'),
    LIMITS.create
  )
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 3 || title.length > 100) return json({ error: 'bad_title' }, 400)

  const venueName = typeof body.venueName === 'string' ? body.venueName.trim() : ''
  if (!venueName) return json({ error: 'bad_venue_name' }, 400)

  if (!isFiniteLat(body.lat) || !isFiniteLon(body.lon)) {
    return json({ error: 'bad_coords' }, 400)
  }
  if (!inServiceArea(body.lat, body.lon)) {
    return json({ error: 'outside_service_area' }, 400)
  }

  const startsAt = Number(body.startsAt)
  if (!Number.isFinite(startsAt)) return json({ error: 'bad_times' }, 400)
  const now = Date.now()
  if (startsAt < now - 6 * 60 * 60 * 1000) return json({ error: 'starts_in_past' }, 400)
  if (startsAt > now + 365 * 24 * 60 * 60 * 1000) {
    return json({ error: 'too_far_ahead' }, 400)
  }

  const endsAt = Number.isFinite(Number(body.endsAt)) ? Number(body.endsAt) : null
  const category = (EVENT_CATEGORIES as readonly string[]).includes(String(body.category))
    ? String(body.category)
    : 'other'

  // Rupees in, paise stored. Free is an explicit 0, not a null.
  const toPaise = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
  }
  const priceMin = body.isFree === true ? 0 : toPaise(body.priceMin)
  const priceMax = body.isFree === true ? 0 : toPaise(body.priceMax)

  const ticketUrl =
    typeof body.ticketUrl === 'string' && /^https?:\/\//i.test(body.ticketUrl.trim())
      ? body.ticketUrl.trim().slice(0, 500)
      : null

  const id = crypto.randomUUID()
  const expiresAt = (endsAt ?? startsAt + 4 * 60 * 60 * 1000) + GRACE_MS

  await env.DB.prepare(
    `INSERT INTO events
       (id, source, external_id, creator_id, title, description, category, emoji,
        venue_name, address, lat, lon, starts_at, ends_at,
        price_min, price_max, currency, ticket_url, image_url, created_at, expires_at)
     VALUES (?, 'community', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, NULL, ?, ?)`
  )
    .bind(
      id,
      user.id,
      title,
      typeof body.description === 'string' ? body.description.trim().slice(0, 600) : null,
      category,
      CATEGORY_EMOJI[category] ?? '🎫',
      venueName.slice(0, 120),
      typeof body.address === 'string' ? body.address.trim().slice(0, 200) : null,
      body.lat,
      body.lon,
      startsAt,
      endsAt,
      priceMin,
      priceMax,
      ticketUrl,
      now,
      expiresAt
    )
    .run()

  const roomId = await ensureRoom(env, 'event', id, title, CATEGORY_EMOJI[category], expiresAt)
  await joinRoom(env, roomId, user.id)
  await env.DB.prepare(
    'INSERT OR IGNORE INTO event_attendees (event_id, user_id, joined_at) VALUES (?, ?, ?)'
  )
    .bind(id, user.id, now)
    .run()

  return json({ id, roomId }, 201)
}

async function joinEvent(env: Env, user: User, eventId: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT title, emoji, category, expires_at FROM events WHERE id = ? AND expires_at > ?'
  )
    .bind(eventId, Date.now())
    .first<{ title: string; emoji: string | null; category: string | null; expires_at: number }>()

  if (!row) return json({ error: 'not_found' }, 404)

  const roomId = await ensureRoom(
    env,
    'event',
    eventId,
    row.title,
    row.emoji ?? CATEGORY_EMOJI[row.category ?? 'other'] ?? '🎫',
    row.expires_at
  )

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO event_attendees (event_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).bind(eventId, user.id, Date.now()),
  ])
  await joinRoom(env, roomId, user.id)

  return json({ joined: true, roomId })
}

async function leaveEvent(env: Env, user: User, eventId: string): Promise<Response> {
  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE kind = 'event' AND ref_id = ?"
  )
    .bind(eventId)
    .first<{ id: string }>()

  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?'
    ).bind(eventId, user.id),
    ...(room
      ? [
          env.DB.prepare(
            'DELETE FROM room_members WHERE room_id = ? AND user_id = ?'
          ).bind(room.id, user.id),
        ]
      : []),
  ])

  return json({ joined: false })
}

async function deleteEvent(env: Env, user: User, eventId: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT creator_id, source FROM events WHERE id = ?'
  )
    .bind(eventId)
    .first<{ creator_id: string | null; source: string }>()

  if (!row) return json({ error: 'not_found' }, 404)
  // Imported events aren't ours to delete — they'd reappear on the next refresh.
  if (row.source !== 'community') return json({ error: 'not_deletable' }, 400)
  if (row.creator_id !== user.id) return json({ error: 'not_the_creator' }, 403)

  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE kind = 'event' AND ref_id = ?"
  )
    .bind(eventId)
    .first<{ id: string }>()

  await env.DB.batch([
    ...(room
      ? [
          env.DB.prepare('DELETE FROM room_messages WHERE room_id = ?').bind(room.id),
          env.DB.prepare('DELETE FROM room_members WHERE room_id = ?').bind(room.id),
          env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(room.id),
        ]
      : []),
    env.DB.prepare('DELETE FROM event_attendees WHERE event_id = ?').bind(eventId),
    env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId),
  ])

  return json({ deleted: true })
}

// ---------------------------------------------------------------------------
// Ticketmaster adapter
// ---------------------------------------------------------------------------

/** Greater Mumbai, for the Discovery geo filter. */
const MUMBAI = { lat: 19.076, lon: 72.8777, radiusKm: 40 }

interface TmEvent {
  id: string
  name: string
  url?: string
  info?: string
  dates?: { start?: { dateTime?: string; localDate?: string } }
  classifications?: { segment?: { name?: string } }[]
  priceRanges?: { min?: number; max?: number; currency?: string }[]
  images?: { url?: string; width?: number }[]
  _embedded?: {
    venues?: {
      name?: string
      address?: { line1?: string }
      location?: { latitude?: string; longitude?: string }
    }[]
  }
}

/** Map Ticketmaster's segment names onto our categories. */
function categoryFromSegment(segment: string | undefined): string {
  switch ((segment ?? '').toLowerCase()) {
    case 'music':
      return 'music'
    case 'sports':
      return 'sport'
    case 'arts & theatre':
      return 'arts'
    default:
      return 'other'
  }
}

/**
 * Pull Mumbai events from Ticketmaster and upsert them.
 *
 * Coverage for India is genuinely thin — this may legitimately return very
 * little. That is a property of the source, not a bug here, and the UI says
 * where each event came from so the gap is visible rather than mysterious.
 */
async function refreshTicketmaster(env: Env): Promise<{ imported: number; error?: string }> {
  if (!env.TICKETMASTER_API_KEY) return { imported: 0, error: 'not_configured' }

  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json')
  url.searchParams.set('apikey', env.TICKETMASTER_API_KEY)
  url.searchParams.set('latlong', `${MUMBAI.lat},${MUMBAI.lon}`)
  url.searchParams.set('radius', String(MUMBAI.radiusKm))
  url.searchParams.set('unit', 'km')
  url.searchParams.set('size', '100')
  url.searchParams.set('sort', 'date,asc')

  let res: Response
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) })
  } catch {
    return { imported: 0, error: 'unreachable' }
  }
  if (!res.ok) return { imported: 0, error: `http_${res.status}` }

  const body = (await res.json()) as { _embedded?: { events?: TmEvent[] } }
  const events = body._embedded?.events ?? []
  if (!events.length) return { imported: 0 }

  const now = Date.now()
  const statements = []

  for (const e of events) {
    const venue = e._embedded?.venues?.[0]
    const lat = Number(venue?.location?.latitude)
    const lon = Number(venue?.location?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (!inServiceArea(lat, lon)) continue

    const startIso = e.dates?.start?.dateTime ?? e.dates?.start?.localDate
    const startsAt = startIso ? Date.parse(startIso) : NaN
    if (!Number.isFinite(startsAt)) continue

    const price = e.priceRanges?.[0]
    const category = categoryFromSegment(e.classifications?.[0]?.segment?.name)
    const image = e.images?.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null

    statements.push(
      env.DB.prepare(
        `INSERT INTO events
           (id, source, external_id, creator_id, title, description, category, emoji,
            venue_name, address, lat, lon, starts_at, ends_at,
            price_min, price_max, currency, ticket_url, image_url, created_at, expires_at)
         VALUES (?, 'ticketmaster', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, external_id) DO UPDATE SET
           title = excluded.title, starts_at = excluded.starts_at,
           venue_name = excluded.venue_name, lat = excluded.lat, lon = excluded.lon,
           price_min = excluded.price_min, price_max = excluded.price_max,
           ticket_url = excluded.ticket_url, image_url = excluded.image_url,
           expires_at = excluded.expires_at`
      ).bind(
        crypto.randomUUID(),
        e.id,
        e.name.slice(0, 100),
        e.info ? e.info.slice(0, 600) : null,
        category,
        CATEGORY_EMOJI[category] ?? '🎫',
        (venue?.name ?? 'Venue').slice(0, 120),
        venue?.address?.line1 ?? null,
        lat,
        lon,
        startsAt,
        price?.min != null ? Math.round(price.min * 100) : null,
        price?.max != null ? Math.round(price.max * 100) : null,
        price?.currency ?? 'INR',
        e.url ?? null,
        image,
        now,
        startsAt + 4 * 60 * 60 * 1000 + GRACE_MS
      )
    )
  }

  if (!statements.length) return { imported: 0 }
  await env.DB.batch(statements)
  return { imported: statements.length }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const UUID = '[0-9a-fA-F-]{36}'

export async function routeEvents(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/events')) return null

  // Browsing events needs no account — that's the point of the public page.
  const user = await currentUser(request, env)

  if (url.pathname === '/api/events') {
    if (request.method === 'GET') return listEvents(request, env, user)
    if (request.method === 'POST') {
      const denied = requireUser(user)
      if (denied) return denied
      return createEvent(request, env, user as User)
    }
  }

  if (url.pathname === '/api/events/refresh' && request.method === 'POST') {
    const limit = await checkRateLimit(
      env,
      await rateBucket(request, env, 'event-refresh'),
      LIMITS.refresh
    )
    if (!limit.ok) return json({ error: 'rate_limited' }, 429)
    // Every source, so an empty board can be filled in one action. Each is
    // reported separately: a source being down should be visible, not silently
    // absorbed into one smaller number.
    const seeded = await seedEvents(env)
    const luma = await refreshLuma(env, emojiFor, GRACE_MS)
    const allevents = await refreshAllEvents(env, emojiFor, GRACE_MS)
    const ticketmaster = await refreshTicketmaster(env)
    return json({
      seeded,
      luma,
      allevents,
      ticketmaster,
      imported: luma.imported + allevents.imported + ticketmaster.imported,
    })
  }

  const detail = url.pathname.match(new RegExp(`^/api/events/(${UUID})$`))
  if (detail && request.method === 'GET') return eventDetail(env, user, detail[1])

  const join = url.pathname.match(new RegExp(`^/api/events/(${UUID})/join$`))
  if (join && request.method === 'POST') {
    const denied = requireUser(user)
    if (denied) return denied
    return joinEvent(env, user as User, join[1])
  }

  const leave = url.pathname.match(new RegExp(`^/api/events/(${UUID})/leave$`))
  if (leave && request.method === 'POST') {
    const denied = requireUser(user)
    if (denied) return denied
    return leaveEvent(env, user as User, leave[1])
  }

  const remove = url.pathname.match(new RegExp(`^/api/events/(${UUID})/delete$`))
  if (remove && request.method === 'POST') {
    const denied = requireUser(user)
    if (denied) return denied
    return deleteEvent(env, user as User, remove[1])
  }

  return json({ error: 'not_found' }, 404)
}

/** Cron: drop finished events, then top up from every external source. */
export async function sweepEvents(env: Env): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM event_attendees WHERE event_id IN (SELECT id FROM events WHERE expires_at < ?)'
    ).bind(now),
    env.DB.prepare('DELETE FROM events WHERE expires_at < ?').bind(now),
  ])
  await seedEvents(env)
  await refreshLuma(env, emojiFor, GRACE_MS)
  await refreshAllEvents(env, emojiFor, GRACE_MS)
  await refreshTicketmaster(env)
}
