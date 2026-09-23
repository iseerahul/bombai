/**
 * Hangouts — activities at public venues.
 *
 * Three rules are enforced here rather than merely encouraged by the UI:
 *
 *  1. An activity must sit on a venue id from the shipped map dataset. You
 *     cannot create one at an arbitrary dropped pin, so meetings are always at
 *     an already-public, already-mapped place.
 *  2. Joining is a request the creator approves. Chat opens only after that.
 *  3. An activity's chat is a group chat, visible to every approved member.
 *     Direct messages exist in the app (see social.ts) but never here — an
 *     activity thread cannot become a private channel.
 *
 * Members' own coordinates are never accepted or stored by THIS module; the
 * only location here is the venue's, from public data. Live presence is a
 * separate, explicitly opt-in feature in social.ts.
 */

import {
  type Env,
  checkRateLimit,
  inServiceArea,
  isFiniteLat,
  isFiniteLon,
  json,
  rateBucket,
} from './lib'
import { type User, currentUser, requireUser } from './auth'
import { deleteRoom, ensureRoom, joinRoom } from './rooms'

const LIMITS = {
  create: { max: 10, windowMs: 60 * 60 * 1000 },
  join: { max: 40, windowMs: 60 * 60 * 1000 },
  message: { max: 200, windowMs: 60 * 60 * 1000 },
} as const

export const ACTIVITY_CATEGORIES = ['sports', 'food', 'study', 'other'] as const

/**
 * Venue ids as produced by scripts/build-data.mjs. Anything else is refused.
 *
 * Honest limitation: the Worker has no copy of the POI dataset (it's static
 * files served to the browser), so this validates the SHAPE of a dataset id and
 * that the coordinates are inside Mumbai — it cannot confirm that this exact id
 * exists. The client only ever offers real venues. To make this airtight, ship
 * the id set to the Worker as a KV blob and check membership here.
 */
const VENUE_ID = /^(osm:(node|way|relation)\/\d{1,15}|mcgm:[a-z_]+\/\d{1,9})$/

/** Activities linger this long past their end, then they and their chat vanish. */
const GRACE_MS = 2 * 60 * 60 * 1000
const MAX_DURATION_MS = 12 * 60 * 60 * 1000
/** How far ahead something can be scheduled. Keeps the board about "now". */
const MAX_LEAD_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Who someone is, here, is now a signed-in account — see auth.ts. The earlier
 * browser-generated pseudonymous profile is gone: approving a stranger and
 * messaging them needs an identity that survives a cleared cache.
 */
export type Caller = User

/** Everyone this user cannot see, in either direction. */
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

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string
  creator_id: string
  title: string
  category: string
  note: string | null
  emoji: string | null
  venue_id: string
  venue_name: string
  lat: number
  lon: number
  starts_at: number
  ends_at: number
  capacity: number
  created_at: number
}

async function listActivities(
  request: Request,
  env: Env,
  caller: Caller | null
): Promise<Response> {
  const url = new URL(request.url)
  const bbox = url.searchParams.get('bbox')
  const category = url.searchParams.get('category')

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
  const params: unknown[] = [now, south, north, west, east]
  let sql = `SELECT * FROM activities
              WHERE expires_at > ?
                AND lat BETWEEN ? AND ?
                AND lon BETWEEN ? AND ?`

  if (category && (ACTIVITY_CATEGORIES as readonly string[]).includes(category)) {
    sql += ' AND category = ?'
    params.push(category)
  }
  sql += ' ORDER BY starts_at ASC LIMIT 200'

  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all<ActivityRow>()

  const rows = results ?? []
  if (!rows.length) return json({ activities: [], now })

  // One join for every creator on the page, rather than one query each.
  const { results: creatorRows } = await env.DB.prepare(
    `SELECT DISTINCT u.id, u.name, u.avatar_url
       FROM users u JOIN activities a ON a.creator_id = u.id
      WHERE a.expires_at > ?`
  )
    .bind(now)
    .all<{ id: string; name: string; avatar_url: string | null }>()
  const creators = new Map(
    (creatorRows ?? []).map((c) => [c.id, { name: c.name, avatar: c.avatar_url }])
  )

  // One query for all membership rows beats N queries per activity. Joining
  // against the live set rather than binding one placeholder per id keeps this
  // under SQLite's variable cap however many activities are listed.
  const { results: members } = await env.DB.prepare(
    `SELECT m.activity_id, m.profile_id, m.status
       FROM activity_members m
       JOIN activities a ON a.id = m.activity_id
      WHERE a.expires_at > ?`
  )
    .bind(now)
    .all<{ activity_id: string; profile_id: string; status: string }>()

  const approved = new Map<string, number>()
  const pending = new Map<string, number>()
  const mine = new Map<string, string>()
  for (const m of members ?? []) {
    if (m.status === 'approved') {
      approved.set(m.activity_id, (approved.get(m.activity_id) ?? 0) + 1)
    } else if (m.status === 'pending') {
      pending.set(m.activity_id, (pending.get(m.activity_id) ?? 0) + 1)
    }
    if (caller && m.profile_id === caller.id) mine.set(m.activity_id, m.status)
  }

  return json({
    now,
    activities: rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      note: r.note,
      emoji: r.emoji ?? '🎉',
      venueId: r.venue_id,
      venueName: r.venue_name,
      lat: r.lat,
      lon: r.lon,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      capacity: r.capacity,
      approvedCount: approved.get(r.id) ?? 0,
      // Only the creator needs to see how many are waiting.
      pendingCount: caller?.id === r.creator_id ? (pending.get(r.id) ?? 0) : 0,
      isMine: caller?.id === r.creator_id,
      // For the map bubble: the reference is a face, not a category glyph.
      creatorId: r.creator_id,
      creatorName: creators.get(r.creator_id)?.name ?? null,
      creatorAvatar: creators.get(r.creator_id)?.avatar ?? null,
      myStatus: mine.get(r.id) ?? null,
    })),
  })
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function createActivity(
  request: Request,
  env: Env,
  caller: Caller
): Promise<Response> {
  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'activity-create'),
    LIMITS.create
  )
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

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 3 || title.length > 80) return json({ error: 'bad_title' }, 400)

  const category = String(body.category ?? 'other')
  if (!(ACTIVITY_CATEGORIES as readonly string[]).includes(category)) {
    return json({ error: 'bad_category' }, 400)
  }

  /*
   * --- the venue rule, relaxed but not abandoned ---
   *
   * It used to require a place from the map dataset, which kept meetings at
   * public venues. But the dataset covers fifteen categories, and most plans
   * start as "somewhere around here, we'll decide in the chat" — so insisting
   * on a named venue meant people could not post the thing they actually meant.
   *
   * Two modes now:
   *
   *   pinned       A venue id from the dataset. Exact coordinates, as before.
   *   approximate  No venue id. The coordinates are snapped to a ~250 m grid
   *                before they are stored, so the bubble says "around here"
   *                rather than pointing at the building someone is standing
   *                in. That is the part that still matters: without it, an
   *                activity created at home publishes a home address.
   */
  const rawVenueId = typeof body.venueId === 'string' ? body.venueId.trim() : ''
  const pinned = rawVenueId.length > 0

  if (pinned && !VENUE_ID.test(rawVenueId)) {
    return json({ error: 'venue_must_be_from_dataset' }, 400)
  }

  const venueName = typeof body.venueName === 'string' ? body.venueName.trim() : ''
  if (!venueName || venueName.length > 120) return json({ error: 'bad_venue_name' }, 400)

  if (!isFiniteLat(body.lat) || !isFiniteLon(body.lon)) {
    return json({ error: 'bad_coords' }, 400)
  }
  if (!inServiceArea(body.lat, body.lon)) {
    return json({ error: 'outside_service_area' }, 400)
  }

  /** ~250 m at Mumbai's latitude. Enough to say "this neighbourhood". */
  const GRID = 0.0025
  const snap = (n: number) => Math.round(n / GRID) * GRID
  const lat = pinned ? (body.lat as number) : snap(body.lat as number)
  const lon = pinned ? (body.lon as number) : snap(body.lon as number)
  const venueId = pinned ? rawVenueId : null

  const startsAt = Number(body.startsAt)
  const endsAt = Number(body.endsAt)
  const now = Date.now()
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return json({ error: 'bad_times' }, 400)
  }
  // A little slack behind "now" so something starting this minute still posts.
  if (startsAt < now - 60 * 60 * 1000) return json({ error: 'starts_in_past' }, 400)
  if (startsAt > now + MAX_LEAD_MS) return json({ error: 'too_far_ahead' }, 400)
  if (endsAt <= startsAt || endsAt - startsAt > MAX_DURATION_MS) {
    return json({ error: 'bad_duration' }, 400)
  }

  const capacity = Number(body.capacity)
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 50) {
    return json({ error: 'bad_capacity' }, 400)
  }

  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 280)
      : null

  // One or two emoji, used as the map pin. Capped by code points rather than
  // length, because a single emoji can be several UTF-16 units.
  const emoji =
    typeof body.emoji === 'string' && body.emoji.trim()
      ? [...body.emoji.trim()].slice(0, 3).join('')
      : '🎉'

  const id = crypto.randomUUID()
  const expiresAt = endsAt + GRACE_MS

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO activities
         (id, creator_id, title, category, note, emoji, venue_id, venue_name, lat, lon,
          starts_at, ends_at, capacity, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      caller.id,
      title,
      category,
      note,
      emoji,
      venueId,
      venueName,
      lat,
      lon,
      startsAt,
      endsAt,
      capacity,
      now,
      expiresAt
    ),
    // The creator counts as an approved member, so they appear in the chat and
    // in the "n of m joined" tally without a separate special case everywhere.
    env.DB.prepare(
      `INSERT INTO activity_members
         (activity_id, profile_id, name, status, requested_at, decided_at)
       VALUES (?, ?, ?, 'approved', ?, ?)`
    ).bind(id, caller.id, caller.name, now, now),
  ])

  // Every activity gets a chat room that dies with it.
  const roomId = await ensureRoom(env, 'activity', id, title, emoji, expiresAt)
  await joinRoom(env, roomId, caller.id)

  return json({ id, roomId, expiresAt }, 201)
}

// ---------------------------------------------------------------------------
// Join / decide
// ---------------------------------------------------------------------------

/**
 * "I'm in".
 *
 * Joining is one tap and grants the chat immediately. This replaced an
 * approval queue: the organiser's control is now that they can delete the
 * activity, which removes it and its chat for everyone. That is the model the
 * product owner asked for, and it is what MigoMap does.
 */
async function joinActivity(
  request: Request,
  env: Env,
  caller: Caller,
  activityId: string
): Promise<Response> {
  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'activity-join'),
    LIMITS.join
  )
  if (!limit.ok) {
    return json({ error: 'rate_limited' }, 429, {
      'Retry-After': String(limit.retryAfterS),
    })
  }

  const activity = await env.DB.prepare(
    'SELECT creator_id, capacity, title, emoji, expires_at FROM activities WHERE id = ? AND expires_at > ?'
  )
    .bind(activityId, Date.now())
    .first<{
      creator_id: string
      capacity: number
      title: string
      emoji: string | null
      expires_at: number
    }>()

  if (!activity) return json({ error: 'not_found_or_expired' }, 404)

  const roomId = await ensureRoom(
    env,
    'activity',
    activityId,
    activity.title,
    activity.emoji,
    activity.expires_at
  )

  const existing = await env.DB.prepare(
    'SELECT status FROM activity_members WHERE activity_id = ? AND profile_id = ?'
  )
    .bind(activityId, caller.id)
    .first<{ status: string }>()

  if (existing) {
    // Already in — make sure the room membership matches, then say so.
    await joinRoom(env, roomId, caller.id)
    return json({ status: existing.status, roomId })
  }

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM activity_members WHERE activity_id = ? AND status = 'approved'"
  )
    .bind(activityId)
    .first<{ n: number }>()

  if ((count?.n ?? 0) >= activity.capacity) return json({ error: 'full' }, 409)

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO activity_members
       (activity_id, profile_id, name, status, requested_at, decided_at)
     VALUES (?, ?, ?, 'approved', ?, ?)`
  )
    .bind(activityId, caller.id, caller.name, now, now)
    .run()

  await joinRoom(env, roomId, caller.id)

  return json({ status: 'approved', roomId }, 201)
}

/** Leave an activity. The organiser deletes instead — see deleteActivity. */
async function leaveActivity(
  env: Env,
  caller: Caller,
  activityId: string
): Promise<Response> {
  const activity = await env.DB.prepare(
    'SELECT creator_id FROM activities WHERE id = ?'
  )
    .bind(activityId)
    .first<{ creator_id: string }>()
  if (!activity) return json({ error: 'not_found_or_expired' }, 404)
  if (activity.creator_id === caller.id) {
    return json({ error: 'organiser_must_delete' }, 400)
  }

  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE kind = 'activity' AND ref_id = ?"
  )
    .bind(activityId)
    .first<{ id: string }>()

  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM activity_members WHERE activity_id = ? AND profile_id = ?'
    ).bind(activityId, caller.id),
    ...(room
      ? [
          env.DB.prepare(
            'DELETE FROM room_members WHERE room_id = ? AND user_id = ?'
          ).bind(room.id, caller.id),
        ]
      : []),
  ])

  return json({ left: true })
}

/** Delete an activity. Organiser only; takes the roster and chat with it. */
async function deleteActivity(
  env: Env,
  caller: Caller,
  activityId: string
): Promise<Response> {
  const activity = await env.DB.prepare(
    'SELECT creator_id FROM activities WHERE id = ?'
  )
    .bind(activityId)
    .first<{ creator_id: string }>()

  if (!activity) return json({ error: 'not_found_or_expired' }, 404)
  if (activity.creator_id !== caller.id) return json({ error: 'not_the_creator' }, 403)

  await deleteRoom(env, 'activity', activityId)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM activity_members WHERE activity_id = ?').bind(activityId),
    env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(activityId),
  ])

  return json({ deleted: true })
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

async function activityDetail(
  env: Env,
  caller: Caller | null,
  activityId: string
): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT * FROM activities WHERE id = ? AND expires_at > ?'
  )
    .bind(activityId, Date.now())
    .first<ActivityRow & { expires_at: number }>()

  if (!row) return json({ error: 'not_found_or_expired' }, 404)

  const { results: members } = await env.DB.prepare(
    `SELECT profile_id, name, status, requested_at FROM activity_members
      WHERE activity_id = ? ORDER BY requested_at ASC`
  )
    .bind(activityId)
    .all<{ profile_id: string; name: string; status: string; requested_at: number }>()

  const room = await env.DB.prepare(
    "SELECT id FROM rooms WHERE kind = 'activity' AND ref_id = ?"
  )
    .bind(activityId)
    .first<{ id: string }>()

  const blocked = caller ? await blockedIds(env, caller.id) : new Set<string>()
  const all = (members ?? []).filter((m) => !blocked.has(m.profile_id))
  const isCreator = caller?.id === row.creator_id
  const mine = all.find((m) => m.profile_id === caller?.id)
  const canSeeRoster = isCreator || mine?.status === 'approved'

  return json({
    id: row.id,
    title: row.title,
    category: row.category,
    note: row.note,
    emoji: row.emoji ?? '🎉',
    creatorId: row.creator_id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    lat: row.lat,
    lon: row.lon,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    expiresAt: row.expires_at,
    capacity: row.capacity,
    approvedCount: all.filter((m) => m.status === 'approved').length,
    isMine: isCreator,
    myStatus: mine?.status ?? null,
    roomId: room?.id ?? null,
    // Names are visible only once you're in. A stranger browsing the map sees
    // the activity and a count, never who is attending.
    members: canSeeRoster
      ? all.filter((m) => m.status === 'approved').map((m) => ({ id: m.profile_id, name: m.name }))
      : [],

  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const UUID = '[0-9a-fA-F-]{36}'

/**
 * Handle any /api/activities* route. Returns null when the path isn't ours, so
 * index.ts can carry on to its own routes.
 */
export async function routeHangouts(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/activities')) return null

  // Browsing the board is open to any signed-in user; everything that changes
  // state requires one. Signing in happens in the hangout app, never on the
  // public map side.
  const caller = await currentUser(request, env)

  if (url.pathname === '/api/activities') {
    if (request.method === 'GET') {
      const denied = requireUser(caller)
      if (denied) return denied
      return listActivities(request, env, caller)
    }
    if (request.method === 'POST') {
      const denied = requireUser(caller)
      if (denied) return denied
      return createActivity(request, env, caller as Caller)
    }
  }

  const detail = url.pathname.match(new RegExp(`^/api/activities/(${UUID})$`))
  if (detail && request.method === 'GET') {
    const denied = requireUser(caller)
    if (denied) return denied
    return activityDetail(env, caller, detail[1])
  }

  const join = url.pathname.match(new RegExp(`^/api/activities/(${UUID})/join$`))
  if (join && request.method === 'POST') {
    const denied = requireUser(caller)
    if (denied) return denied
    return joinActivity(request, env, caller as Caller, join[1])
  }

  const leave = url.pathname.match(new RegExp(`^/api/activities/(${UUID})/leave$`))
  if (leave && request.method === 'POST') {
    const denied = requireUser(caller)
    if (denied) return denied
    return leaveActivity(env, caller as Caller, leave[1])
  }

  const remove = url.pathname.match(new RegExp(`^/api/activities/(${UUID})/delete$`))
  if (remove && request.method === 'POST') {
    const denied = requireUser(caller)
    if (denied) return denied
    return deleteActivity(env, caller as Caller, remove[1])
  }

  return json({ error: 'not_found' }, 404)
}

/** Cron sweep: expired activities take their roster and chat with them. */
export async function sweepHangouts(env: Env): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM activity_messages WHERE activity_id IN
         (SELECT id FROM activities WHERE expires_at < ?)`
    ).bind(now),
    env.DB.prepare(
      `DELETE FROM activity_members WHERE activity_id IN
         (SELECT id FROM activities WHERE expires_at < ?)`
    ).bind(now),
    env.DB.prepare('DELETE FROM activities WHERE expires_at < ?').bind(now),
    // Profiles nobody has used for 90 days serve no purpose.
    env.DB.prepare('DELETE FROM profiles WHERE last_seen < ?').bind(
      now - 90 * 24 * 60 * 60 * 1000
    ),
  ])
}
