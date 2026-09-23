/**
 * The social half of the hangout app: direct messages, live presence, travel
 * trips, and the block/report machinery those two require.
 *
 * Direct messages and live location were added at the product owner's explicit
 * direction, after the trade-offs were raised. Both are genuine reversals of
 * the original design, so the mitigations are not optional extras here:
 *
 *   - A block is total and bidirectional in effect. A blocked pair cannot see
 *     each other on the map, in a thread list, or in an activity roster, and
 *     messages between them are refused in both directions.
 *   - Presence is a single row per user, overwritten in place and expiring on
 *     its own. There is no location history table, so no trail can be mined
 *     even by whoever runs the server.
 */

import {
  type Env,
  checkRateLimit,
  isFiniteLat,
  isFiniteLon,
  json,
  rateBucket,
} from './lib'
import { type User, currentUser, requireUser } from './auth'
import { ensureRoom, joinRoom, leaveRoom } from './rooms'

const LIMITS = {
  dm: { max: 300, windowMs: 60 * 60 * 1000 },
  presence: { max: 240, windowMs: 60 * 60 * 1000 },
  trip: { max: 10, windowMs: 60 * 60 * 1000 },
  report: { max: 20, windowMs: 24 * 60 * 60 * 1000 },
} as const

/** How long a presence ping stays live before it disappears on its own. */
const PRESENCE_TTL_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

/**
 * Everyone this user cannot interact with, in either direction.
 *
 * Symmetry matters: if A blocks B, B must also stop seeing A. Otherwise
 * blocking announces itself, and the blocked person can still watch.
 */
async function blockedIds(env: Env, userId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `SELECT blocked_id AS other FROM blocks WHERE blocker_id = ?
     UNION
     SELECT blocker_id AS other FROM blocks WHERE blocked_id = ?`
  )
    .bind(userId, userId)
    .all<{ other: string }>()
  return new Set((results ?? []).map((r) => r.other))
}

async function setBlock(
  env: Env,
  userId: string,
  targetId: string,
  blocked: boolean
): Promise<Response> {
  if (targetId === userId) return json({ error: 'cannot_block_yourself' }, 400)

  if (blocked) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
    )
      .bind(userId, targetId, Date.now())
      .run()
  } else {
    await env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .bind(userId, targetId)
      .run()
  }
  return json({ blocked })
}

// ---------------------------------------------------------------------------
// Presence — "who is around right now"
// ---------------------------------------------------------------------------

async function updatePresence(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'presence'),
    LIMITS.presence
  )
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  // Turning sharing off deletes the row outright rather than flagging it
  // hidden — there is then nothing to leak.
  if (body.visible === false) {
    await env.DB.prepare('DELETE FROM presence WHERE user_id = ?').bind(user.id).run()
    return json({ visible: false })
  }

  if (!isFiniteLat(body.lat) || !isFiniteLon(body.lon)) {
    return json({ error: 'bad_coords' }, 400)
  }

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO presence (user_id, lat, lon, updated_at, expires_at, visible)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET
       lat = excluded.lat, lon = excluded.lon,
       updated_at = excluded.updated_at, expires_at = excluded.expires_at, visible = 1`
  )
    .bind(user.id, body.lat, body.lon, now, now + PRESENCE_TTL_MS)
    .run()

  return json({ visible: true, expiresAt: now + PRESENCE_TTL_MS })
}

async function listPeople(request: Request, env: Env, user: User): Promise<Response> {
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

  const { results } = await env.DB.prepare(
    `SELECT p.user_id, p.lat, p.lon, p.updated_at, u.name, u.avatar_url
       FROM presence p JOIN users u ON u.id = p.user_id
      WHERE p.expires_at > ? AND p.visible = 1
        AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?
      LIMIT 300`
  )
    .bind(Date.now(), south, north, west, east)
    .all<{
      user_id: string
      lat: number
      lon: number
      updated_at: number
      name: string
      avatar_url: string | null
    }>()

  const blocked = await blockedIds(env, user.id)

  return json({
    people: (results ?? [])
      .filter((r) => r.user_id !== user.id && !blocked.has(r.user_id))
      .map((r) => ({
        id: r.user_id,
        name: r.name,
        avatarUrl: r.avatar_url,
        lat: r.lat,
        lon: r.lon,
        updatedAt: r.updated_at,
      })),
  })
}

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

/** Threads are keyed by the ordered pair, so a pair can only ever have one. */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

async function openThread(env: Env, me: string, other: string): Promise<string> {
  const [ua, ub] = pairKey(me, other)
  const existing = await env.DB.prepare(
    'SELECT id FROM dm_threads WHERE user_a = ? AND user_b = ?'
  )
    .bind(ua, ub)
    .first<{ id: string }>()
  if (existing) return existing.id

  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO dm_threads (id, user_a, user_b, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, ua, ub, now, now)
    .run()
  return id
}

async function listThreads(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.user_a, t.user_b, t.last_message_at,
            (SELECT body FROM dm_messages m WHERE m.thread_id = t.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_body
       FROM dm_threads t
      WHERE t.user_a = ? OR t.user_b = ?
      ORDER BY t.last_message_at DESC LIMIT 100`
  )
    .bind(user.id, user.id)
    .all<{
      id: string
      user_a: string
      user_b: string
      last_message_at: number
      last_body: string | null
    }>()

  const rows = results ?? []
  const blocked = await blockedIds(env, user.id)

  const visible = rows.filter((t) => {
    const other = t.user_a === user.id ? t.user_b : t.user_a
    return !blocked.has(other)
  })
  if (!visible.length) return json({ threads: [] })

  const otherIds = visible.map((t) => (t.user_a === user.id ? t.user_b : t.user_a))
  const placeholders = otherIds.map(() => '?').join(',')
  const { results: people } = await env.DB.prepare(
    `SELECT id, name, avatar_url FROM users WHERE id IN (${placeholders})`
  )
    .bind(...otherIds)
    .all<{ id: string; name: string; avatar_url: string | null }>()

  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  return json({
    threads: visible.map((t) => {
      const otherId = t.user_a === user.id ? t.user_b : t.user_a
      const other = byId.get(otherId)
      return {
        id: t.id,
        otherId,
        otherName: other?.name ?? 'Someone',
        otherAvatar: other?.avatar_url ?? null,
        lastBody: t.last_body,
        lastAt: t.last_message_at,
      }
    }),
  })
}

/** Confirm the caller is in this thread, and return who they're talking to. */
async function threadPartner(
  env: Env,
  threadId: string,
  userId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT user_a, user_b FROM dm_threads WHERE id = ?'
  )
    .bind(threadId)
    .first<{ user_a: string; user_b: string }>()
  if (!row) return null
  if (row.user_a !== userId && row.user_b !== userId) return null
  return row.user_a === userId ? row.user_b : row.user_a
}

async function dmMessages(
  request: Request,
  env: Env,
  user: User,
  threadId: string
): Promise<Response> {
  const partner = await threadPartner(env, threadId, user.id)
  if (!partner) return json({ error: 'not_in_thread' }, 403)

  const blocked = await blockedIds(env, user.id)
  if (blocked.has(partner)) return json({ error: 'blocked' }, 403)

  const since = Number(new URL(request.url).searchParams.get('since')) || 0
  const { results } = await env.DB.prepare(
    `SELECT id, sender_id, body, created_at FROM dm_messages
      WHERE thread_id = ? AND created_at > ?
      ORDER BY created_at ASC LIMIT 300`
  )
    .bind(threadId, since)
    .all<{ id: string; sender_id: string; body: string; created_at: number }>()

  return json({
    messages: (results ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      mine: m.sender_id === user.id,
    })),
  })
}

async function sendDm(
  request: Request,
  env: Env,
  user: User,
  threadId: string
): Promise<Response> {
  const partner = await threadPartner(env, threadId, user.id)
  if (!partner) return json({ error: 'not_in_thread' }, 403)

  // Refused in both directions: whether they blocked you or you blocked them,
  // nothing gets through.
  const blocked = await blockedIds(env, user.id)
  if (blocked.has(partner)) return json({ error: 'blocked' }, 403)

  const limit = await checkRateLimit(env, await rateBucket(request, env, 'dm'), LIMITS.dm)
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return json({ error: 'empty_message' }, 400)
  if (text.length > 1000) return json({ error: 'message_too_long' }, 400)

  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO dm_messages (id, thread_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, threadId, user.id, text, now),
    env.DB.prepare('UPDATE dm_threads SET last_message_at = ? WHERE id = ?').bind(
      now,
      threadId
    ),
  ])

  return json({ id, createdAt: now }, 201)
}

// ---------------------------------------------------------------------------
// Travel trips
// ---------------------------------------------------------------------------

/**
 * Everyone going to the same place shares one chat, keyed by a slug of the
 * destination. "Bali", "bali" and "BALI " are the same room — otherwise the
 * feature fragments into a dozen near-identical groups and nobody meets anyone.
 */
function destinationSlug(destination: string): string {
  return destination
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/**
 * Display casing for a grouped destination.
 *
 * Trips are grouped by lowercased name, so the row SQL returns carries whichever
 * spelling happened to win — "bali " rather than "Bali". Titling it here keeps
 * the trending cards presentable without forcing everyone to type it the same.
 */
function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Emoji for a destination room, so the chat list isn't a wall of grey. */
function destinationEmoji(destination: string): string {
  const known: Record<string, string> = {
    bali: '🏝️',
    thailand: '🛕',
    goa: '🏖️',
    jaipur: '🏰',
    manali: '🏔️',
    ladakh: '🏔️',
    kerala: '🌴',
    dubai: '🌇',
    singapore: '🦁',
    vietnam: '🇻🇳',
    japan: '🗼',
    nepal: '🏔️',
    rishikesh: '🧘',
  }
  return known[destinationSlug(destination)] ?? '✈️'
}

/**
 * Your own trips.
 *
 * This used to list everybody's, which made "Upcoming" a feed of strangers'
 * holidays with your own buried among them. Other people's plans are browsed
 * through the trending row, where they are grouped by destination and read as
 * an invitation rather than as a list.
 */
async function listTrips(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT t.*, u.name, u.avatar_url,
            (SELECT COUNT(*) FROM trip_members m WHERE m.trip_id = t.id) AS going
       FROM trips t JOIN users u ON u.id = t.user_id
      WHERE t.ends_on > ? AND t.user_id = ?
      ORDER BY t.starts_on ASC LIMIT 100`
  )
    .bind(Date.now(), user.id)
    .all<{
      id: string
      user_id: string
      destination: string
      country: string | null
      starts_on: number
      ends_on: number
      note: string | null
      name: string
      avatar_url: string | null
      going: number
    }>()

  const blocked = await blockedIds(env, user.id)

  const { results: mine } = await env.DB.prepare(
    'SELECT trip_id FROM trip_members WHERE user_id = ?'
  )
    .bind(user.id)
    .all<{ trip_id: string }>()
  const joined = new Set((mine ?? []).map((r) => r.trip_id))

  return json({
    trips: (results ?? [])
      .filter((t) => !blocked.has(t.user_id))
      .map((t) => ({
        id: t.id,
        destination: t.destination,
        country: t.country,
        startsOn: t.starts_on,
        endsOn: t.ends_on,
        note: t.note,
        ownerId: t.user_id,
        ownerName: t.name,
        ownerAvatar: t.avatar_url,
        going: t.going,
        isMine: t.user_id === user.id,
        joined: joined.has(t.id),
      })),
  })
}

async function createTrip(request: Request, env: Env, user: User): Promise<Response> {
  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'trip'),
    LIMITS.trip
  )
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const destination =
    typeof body.destination === 'string' ? body.destination.trim().slice(0, 80) : ''
  if (destination.length < 2) return json({ error: 'bad_destination' }, 400)

  const startsOn = Number(body.startsOn)
  const endsOn = Number(body.endsOn)
  if (!Number.isFinite(startsOn) || !Number.isFinite(endsOn) || endsOn < startsOn) {
    return json({ error: 'bad_dates' }, 400)
  }

  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO trips (id, user_id, destination, country, starts_on, ends_on, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user.id,
      destination,
      typeof body.country === 'string' ? body.country.trim().slice(0, 60) : null,
      startsOn,
      endsOn,
      typeof body.note === 'string' ? body.note.trim().slice(0, 280) : null,
      now
    ),
    env.DB.prepare(
      'INSERT INTO trip_members (trip_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).bind(id, user.id, now),
  ])

  // Planning a trip puts you straight into the room for that destination —
  // the point of saying you're going is meeting the others who are.
  const roomId = await ensureRoom(
    env,
    'destination',
    destinationSlug(destination),
    titleCase(destination),
    destinationEmoji(destination),
    null
  )
  await joinRoom(env, roomId, user.id)

  return json({ id, roomId }, 201)
}

async function joinTrip(env: Env, user: User, tripId: string): Promise<Response> {
  const trip = await env.DB.prepare(
    'SELECT user_id, destination FROM trips WHERE id = ?'
  )
    .bind(tripId)
    .first<{ user_id: string; destination: string }>()
  if (!trip) return json({ error: 'not_found' }, 404)

  const blocked = await blockedIds(env, user.id)
  if (blocked.has(trip.user_id)) return json({ error: 'blocked' }, 403)

  await env.DB.prepare(
    'INSERT OR IGNORE INTO trip_members (trip_id, user_id, joined_at) VALUES (?, ?, ?)'
  )
    .bind(tripId, user.id, Date.now())
    .run()

  const roomId = await ensureRoom(
    env,
    'destination',
    destinationSlug(trip.destination),
    titleCase(trip.destination),
    destinationEmoji(trip.destination),
    null
  )
  await joinRoom(env, roomId, user.id)

  return json({ joined: true, roomId })
}

/**
 * Leave a trip you joined.
 *
 * Leaves the destination chat too. The two were joined together, so leaving
 * one while silently staying in the other would be a surprise — the point of
 * leaving is to stop hearing about it.
 *
 * The owner cannot leave their own trip; they delete it instead.
 */
async function leaveTrip(env: Env, user: User, tripId: string): Promise<Response> {
  const trip = await env.DB.prepare('SELECT user_id, destination FROM trips WHERE id = ?')
    .bind(tripId)
    .first<{ user_id: string; destination: string }>()
  if (!trip) return json({ error: 'not_found' }, 404)
  if (trip.user_id === user.id) return json({ error: 'owner_cannot_leave' }, 400)

  await env.DB.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?')
    .bind(tripId, user.id)
    .run()

  const slug = destinationSlug(trip.destination)
  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE kind = 'destination' AND ref_id = ?"
  )
    .bind(slug)
    .first<{ id: string }>()

  /*
   * Only leave the destination room if no other trip of yours goes there.
   * Two trips to Goa share one chat, and cancelling one of them should not
   * throw you out of the other.
   */
  if (room) {
    const others = await env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM trip_members m
         JOIN trips t ON t.id = m.trip_id
        WHERE m.user_id = ? AND t.destination = ? AND m.trip_id != ?`
    )
      .bind(user.id, trip.destination, tripId)
      .first<{ n: number }>()
    const ownsAnother = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM trips WHERE user_id = ? AND destination = ? AND id != ?'
    )
      .bind(user.id, trip.destination, tripId)
      .first<{ n: number }>()

    if ((others?.n ?? 0) === 0 && (ownsAnother?.n ?? 0) === 0) {
      await leaveRoom(env, room.id, user.id)
    }
  }

  return json({ left: true })
}

/** Delete a trip you own, and everyone's membership of it. */
async function deleteTrip(env: Env, user: User, tripId: string): Promise<Response> {
  const trip = await env.DB.prepare('SELECT user_id FROM trips WHERE id = ?')
    .bind(tripId)
    .first<{ user_id: string }>()
  if (!trip) return json({ error: 'not_found' }, 404)
  if (trip.user_id !== user.id) return json({ error: 'not_the_owner' }, 403)

  /*
   * The destination room is deliberately left alone. It is shared by everyone
   * travelling there, not owned by this trip, so deleting a trip must not
   * delete a conversation other people are still having.
   */
  await env.DB.batch([
    env.DB.prepare('DELETE FROM trip_members WHERE trip_id = ?').bind(tripId),
    env.DB.prepare('DELETE FROM trips WHERE id = ?').bind(tripId),
  ])

  return json({ deleted: true })
}

/**
 * Trending destinations: where people are actually going, with how many.
 * Grouped by slug so "Bali" and "bali" are one place.
 */
async function trendingDestinations(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT t.destination, t.country, COUNT(DISTINCT m.user_id) AS travellers,
            MIN(t.starts_on) AS next_start
       FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id
      WHERE t.ends_on > ?
      GROUP BY LOWER(t.destination)
      ORDER BY travellers DESC, next_start ASC
      LIMIT 20`
  )
    .bind(Date.now())
    .all<{
      destination: string
      country: string | null
      travellers: number
      next_start: number
    }>()

  const rows = results ?? []
  if (!rows.length) return json({ trending: [] })

  // Which of these rooms the caller is already in, so the card can say "Open"
  // rather than "Join".
  const slugs = rows.map((r) => destinationSlug(r.destination))
  const placeholders = slugs.map(() => '?').join(',')
  const { results: mine } = await env.DB.prepare(
    `SELECT r.ref_id, r.id FROM rooms r
       JOIN room_members m ON m.room_id = r.id AND m.user_id = ?
      WHERE r.kind = 'destination' AND r.ref_id IN (${placeholders})`
  )
    .bind(user.id, ...slugs)
    .all<{ ref_id: string; id: string }>()

  const joined = new Map((mine ?? []).map((r) => [r.ref_id, r.id]))

  const { results: roomTitles } = await env.DB.prepare(
    `SELECT ref_id, title FROM rooms
      WHERE kind = 'destination' AND ref_id IN (${placeholders})`
  )
    .bind(...slugs)
    .all<{ ref_id: string; title: string }>()
  const titles = new Map((roomTitles ?? []).map((r) => [r.ref_id, r.title]))

  return json({
    trending: rows.map((r) => {
      const slug = destinationSlug(r.destination)
      return {
        // Normalise on the way out regardless of source: the room title is
        // whatever the first person happened to type, which may itself be
        // "bali " rather than "Bali".
        destination: titleCase(titles.get(slug) ?? r.destination),
        slug,
        country: r.country,
        emoji: destinationEmoji(r.destination),
        travellers: r.travellers,
        nextStart: r.next_start,
        roomId: joined.get(slug) ?? null,
      }
    }),
  })
}

/** Join a destination room directly from a trending card. */
/**
 * Who is going to a destination, without joining anything.
 *
 * Tapping a trending card used to put you straight into the group chat, which
 * is a surprising thing for a browse gesture to do — you were in a room with
 * strangers before deciding you wanted to be. This is the look-first half:
 * the faces, the count, and an explicit way in.
 */
async function destinationDetail(
  env: Env,
  user: User,
  slug: string
): Promise<Response> {
  const room = await env.DB.prepare(
    "SELECT id, title, emoji FROM rooms WHERE kind = 'destination' AND ref_id = ?"
  )
    .bind(slug)
    .first<{ id: string; title: string; emoji: string }>()

  if (!room) {
    return json({ slug, title: null, members: [], joined: false, roomId: null })
  }

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url
       FROM room_members m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ?
      ORDER BY m.joined_at ASC LIMIT 60`
  )
    .bind(room.id)
    .all<{ id: string; name: string; avatar_url: string | null }>()

  // Blocked people vanish from the list, as everywhere else.
  const blocked = await blockedIds(env, user.id)
  const visible = (results ?? []).filter((m) => !blocked.has(m.id))

  return json({
    slug,
    title: room.title,
    emoji: room.emoji,
    roomId: room.id,
    joined: visible.some((m) => m.id === user.id),
    members: visible.map((m) => ({
      id: m.id,
      name: m.name,
      avatarUrl: m.avatar_url,
    })),
  })
}

async function joinDestination(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const destination =
    typeof body.destination === 'string' ? body.destination.trim().slice(0, 80) : ''
  if (destination.length < 2) return json({ error: 'bad_destination' }, 400)

  const roomId = await ensureRoom(
    env,
    'destination',
    destinationSlug(destination),
    titleCase(destination),
    destinationEmoji(destination),
    null
  )
  await joinRoom(env, roomId, user.id)
  return json({ roomId })
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

async function report(request: Request, env: Env, user: User): Promise<Response> {
  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'abuse-report'),
    LIMITS.report
  )
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const targetType = String(body.targetType ?? '')
  if (!['user', 'activity', 'message'].includes(targetType)) {
    return json({ error: 'bad_target_type' }, 400)
  }
  const targetId = typeof body.targetId === 'string' ? body.targetId : ''
  if (!targetId) return json({ error: 'bad_target' }, 400)

  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 60) : 'other'

  await env.DB.prepare(
    `INSERT INTO abuse_reports (id, reporter_id, target_type, target_id, reason, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      targetType,
      targetId,
      reason,
      typeof body.detail === 'string' ? body.detail.trim().slice(0, 500) : null,
      Date.now()
    )
    .run()

  // Reporting a person blocks them too. Nobody reports someone and then wants
  // to keep hearing from them while a queue is reviewed.
  if (targetType === 'user' && targetId !== user.id) {
    await setBlock(env, user.id, targetId, true)
  }

  return json({ received: true }, 201)
}

async function publicProfile(env: Env, user: User, id: string): Promise<Response> {
  const blocked = await blockedIds(env, user.id)
  if (blocked.has(id)) return json({ error: 'unavailable' }, 404)

  const row = await env.DB.prepare(
    'SELECT id, name, avatar_url, age, city, bio FROM users WHERE id = ?'
  )
    .bind(id)
    .first<{
      id: string
      name: string
      avatar_url: string | null
      age: number | null
      city: string | null
      bio: string | null
    }>()

  if (!row) return json({ error: 'not_found' }, 404)

  return json({
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    age: row.age,
    city: row.city,
    bio: row.bio,
  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const UUID = '[0-9a-fA-F-]{36}'

export async function routeSocial(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/social')) return null

  const user = await currentUser(request, env)
  const denied = requireUser(user)
  if (denied) return denied
  const me = user as User

  const path = url.pathname.replace('/api/social', '')

  // --- presence ---
  if (path === '/presence' && request.method === 'POST') {
    return updatePresence(request, env, me)
  }
  if (path === '/people' && request.method === 'GET') {
    return listPeople(request, env, me)
  }

  // --- direct messages ---
  if (path === '/threads' && request.method === 'GET') {
    return listThreads(env, me)
  }

  const open = path.match(new RegExp(`^/dm/(${UUID})$`))
  if (open && request.method === 'POST') {
    const other = open[1]
    const blocked = await blockedIds(env, me.id)
    if (blocked.has(other)) return json({ error: 'blocked' }, 403)
    if (other === me.id) return json({ error: 'cannot_dm_yourself' }, 400)
    return json({ threadId: await openThread(env, me.id, other) })
  }

  const thread = path.match(new RegExp(`^/threads/(${UUID})/messages$`))
  if (thread) {
    if (request.method === 'GET') return dmMessages(request, env, me, thread[1])
    if (request.method === 'POST') return sendDm(request, env, me, thread[1])
  }

  // --- travel trips ---
  if (path === '/trips') {
    if (request.method === 'GET') return listTrips(env, me)
    if (request.method === 'POST') return createTrip(request, env, me)
  }
  const tripJoin = path.match(new RegExp(`^/trips/(${UUID})/join$`))
  if (tripJoin && request.method === 'POST') return joinTrip(env, me, tripJoin[1])

  const tripLeave = path.match(new RegExp(`^/trips/(${UUID})/leave$`))
  if (tripLeave && request.method === 'POST') return leaveTrip(env, me, tripLeave[1])

  const tripDelete = path.match(new RegExp(`^/trips/(${UUID})/delete$`))
  if (tripDelete && request.method === 'POST') return deleteTrip(env, me, tripDelete[1])

  if (path === '/trending' && request.method === 'GET') {
    return trendingDestinations(env, me)
  }
  if (path === '/destinations/join' && request.method === 'POST') {
    return joinDestination(request, env, me)
  }

  const destination = path.match(/^\/destinations\/([a-z0-9-]{1,80})$/)
  if (destination && request.method === 'GET') {
    return destinationDetail(env, me, destination[1])
  }

  // --- safety ---
  if (path === '/block' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const targetId = typeof body.userId === 'string' ? body.userId : ''
    if (!targetId) return json({ error: 'bad_target' }, 400)
    return setBlock(env, me.id, targetId, body.blocked !== false)
  }
  if (path === '/report' && request.method === 'POST') {
    return report(request, env, me)
  }
  if (path === '/blocks' && request.method === 'GET') {
    return json({ blocked: [...(await blockedIds(env, me.id))] })
  }

  const profile = path.match(new RegExp(`^/users/(${UUID})$`))
  if (profile && request.method === 'GET') {
    return publicProfile(env, me, profile[1])
  }

  return json({ error: 'not_found' }, 404)
}

/** Cron: presence and finished trips clean themselves up. */
export async function sweepSocial(env: Env): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM presence WHERE expires_at < ?').bind(now),
    env.DB.prepare(
      'DELETE FROM trip_members WHERE trip_id IN (SELECT id FROM trips WHERE ends_on < ?)'
    ).bind(now - 30 * 24 * 60 * 60 * 1000),
    env.DB.prepare('DELETE FROM trips WHERE ends_on < ?').bind(
      now - 30 * 24 * 60 * 60 * 1000
    ),
  ])
}
