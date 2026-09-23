/**
 * Chat rooms.
 *
 * One model for two things that turned out to be identical: the chat attached
 * to an activity, and the chat for everyone heading to a destination. Both are
 * a titled group you join and post in, so both are rooms addressed by
 * (kind, ref_id).
 *
 * Joining is one tap. There is no approval step here — the organiser's control
 * is that they can delete the activity, which takes its room with it.
 */

import { type Env, checkRateLimit, json, rateBucket } from './lib'
import { type User, currentUser, requireUser } from './auth'

const LIMITS = {
  message: { max: 300, windowMs: 60 * 60 * 1000 },
} as const

/**
 * Rooms belong to one of three things. All behave identically once created —
 * a titled group you join and post in — which is why they share a model.
 */
export type RoomKind = 'activity' | 'destination' | 'event'

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

/**
 * Find or create a room. Safe to call repeatedly — the (kind, ref_id) unique
 * index makes this idempotent, which matters because several paths create the
 * same destination room concurrently.
 */
export async function ensureRoom(
  env: Env,
  kind: RoomKind,
  refId: string,
  title: string,
  emoji: string | null,
  expiresAt: number | null
): Promise<string> {
  const existing = await env.DB.prepare(
    'SELECT id FROM rooms WHERE kind = ? AND ref_id = ?'
  )
    .bind(kind, refId)
    .first<{ id: string }>()
  if (existing) return existing.id

  const id = crypto.randomUUID()
  try {
    await env.DB.prepare(
      `INSERT INTO rooms (id, kind, ref_id, title, emoji, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, kind, refId, title.slice(0, 120), emoji, expiresAt, Date.now())
      .run()
    return id
  } catch {
    // Lost a race with a concurrent create; the other one's id is the truth.
    const row = await env.DB.prepare(
      'SELECT id FROM rooms WHERE kind = ? AND ref_id = ?'
    )
      .bind(kind, refId)
      .first<{ id: string }>()
    if (row) return row.id
    throw new Error('could not create room')
  }
}

export async function joinRoom(
  env: Env,
  roomId: string,
  userId: string
): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)'
  )
    .bind(roomId, userId, Date.now())
    .run()
}

export async function leaveRoom(
  env: Env,
  roomId: string,
  userId: string
): Promise<void> {
  await env.DB.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .run()
}

/** Delete a room and everything in it. Used when an activity is deleted. */
export async function deleteRoom(env: Env, kind: RoomKind, refId: string): Promise<void> {
  const room = await env.DB.prepare(
    'SELECT id FROM rooms WHERE kind = ? AND ref_id = ?'
  )
    .bind(kind, refId)
    .first<{ id: string }>()
  if (!room) return

  await env.DB.batch([
    env.DB.prepare('DELETE FROM room_messages WHERE room_id = ?').bind(room.id),
    env.DB.prepare('DELETE FROM room_members WHERE room_id = ?').bind(room.id),
    env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(room.id),
  ])
}

async function isMember(env: Env, roomId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM room_members WHERE room_id = ? AND user_id = ?'
  )
    .bind(roomId, userId)
    .first<{ ok: number }>()
  return Boolean(row)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listRooms(env: Env, user: User): Promise<Response> {
  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.kind, r.ref_id, r.title, r.emoji,
            (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS members,
            (SELECT body FROM room_messages x WHERE x.room_id = r.id
              ORDER BY x.created_at DESC LIMIT 1) AS last_body,
            (SELECT name FROM room_messages x WHERE x.room_id = r.id
              ORDER BY x.created_at DESC LIMIT 1) AS last_name,
            (SELECT created_at FROM room_messages x WHERE x.room_id = r.id
              ORDER BY x.created_at DESC LIMIT 1) AS last_at
       FROM rooms r
       JOIN room_members me ON me.room_id = r.id AND me.user_id = ?
      WHERE r.expires_at IS NULL OR r.expires_at > ?
      ORDER BY COALESCE(last_at, r.created_at) DESC
      LIMIT 100`
  )
    .bind(user.id, now)
    .all<{
      id: string
      kind: string
      ref_id: string
      title: string
      emoji: string | null
      members: number
      last_body: string | null
      last_name: string | null
      last_at: number | null
    }>()

  return json({
    rooms: (results ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      refId: r.ref_id,
      title: r.title,
      emoji: r.emoji ?? '💬',
      members: r.members,
      lastBody: r.last_body,
      lastName: r.last_name,
      lastAt: r.last_at,
    })),
  })
}

async function roomDetail(env: Env, user: User, roomId: string): Promise<Response> {
  const room = await env.DB.prepare(
    'SELECT id, kind, ref_id, title, emoji FROM rooms WHERE id = ?'
  )
    .bind(roomId)
    .first<{
      id: string
      kind: string
      ref_id: string
      title: string
      emoji: string | null
    }>()

  if (!room) return json({ error: 'not_found' }, 404)

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url
       FROM room_members m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? ORDER BY m.joined_at ASC LIMIT 200`
  )
    .bind(roomId)
    .all<{ id: string; name: string; avatar_url: string | null }>()

  const blocked = await blockedIds(env, user.id)

  return json({
    id: room.id,
    kind: room.kind,
    refId: room.ref_id,
    title: room.title,
    emoji: room.emoji ?? '💬',
    joined: await isMember(env, roomId, user.id),
    members: (results ?? [])
      .filter((m) => !blocked.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatar_url })),
  })
}

async function listMessages(
  request: Request,
  env: Env,
  user: User,
  roomId: string
): Promise<Response> {
  if (!(await isMember(env, roomId, user.id))) {
    return json({ error: 'not_a_member' }, 403)
  }

  const since = Number(new URL(request.url).searchParams.get('since')) || 0
  /*
   * Joined to `users` for the avatar rather than storing it on the message.
   * The name is denormalised onto the row (so an old message keeps the name it
   * was sent under), but a picture should follow the person: change your photo
   * and it changes everywhere you have ever spoken, which is what people
   * expect.
   */
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.user_id, m.name, m.body, m.created_at, u.avatar_url
       FROM room_messages m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? AND m.created_at > ?
      ORDER BY m.created_at ASC LIMIT 300`
  )
    .bind(roomId, since)
    .all<{
      id: string
      user_id: string
      name: string
      body: string
      created_at: number
      avatar_url: string | null
    }>()

  // A blocked person's messages disappear from the room for the blocker.
  const blocked = await blockedIds(env, user.id)

  return json({
    messages: (results ?? [])
      .filter((m) => !blocked.has(m.user_id))
      .map((m) => ({
        id: m.id,
        userId: m.user_id,
        name: m.name,
        avatarUrl: m.avatar_url,
        body: m.body,
        createdAt: m.created_at,
        mine: m.user_id === user.id,
      })),
  })
}

async function postMessage(
  request: Request,
  env: Env,
  user: User,
  roomId: string
): Promise<Response> {
  if (!(await isMember(env, roomId, user.id))) {
    return json({ error: 'not_a_member' }, 403)
  }

  const limit = await checkRateLimit(
    env,
    await rateBucket(request, env, 'room-message'),
    LIMITS.message
  )
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
  await env.DB.prepare(
    'INSERT INTO room_messages (id, room_id, user_id, name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, roomId, user.id, user.name, text, now)
    .run()

  return json({ id, createdAt: now }, 201)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const UUID = '[0-9a-fA-F-]{36}'

export async function routeRooms(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/rooms')) return null

  const user = await currentUser(request, env)
  const denied = requireUser(user)
  if (denied) return denied
  const me = user as User

  if (url.pathname === '/api/rooms' && request.method === 'GET') {
    return listRooms(env, me)
  }

  const detail = url.pathname.match(new RegExp(`^/api/rooms/(${UUID})$`))
  if (detail && request.method === 'GET') return roomDetail(env, me, detail[1])

  const join = url.pathname.match(new RegExp(`^/api/rooms/(${UUID})/join$`))
  if (join && request.method === 'POST') {
    await joinRoom(env, join[1], me.id)
    return json({ joined: true })
  }

  const leave = url.pathname.match(new RegExp(`^/api/rooms/(${UUID})/leave$`))
  if (leave && request.method === 'POST') {
    await leaveRoom(env, leave[1], me.id)
    return json({ joined: false })
  }

  const messages = url.pathname.match(new RegExp(`^/api/rooms/(${UUID})/messages$`))
  if (messages) {
    if (request.method === 'GET') return listMessages(request, env, me, messages[1])
    if (request.method === 'POST') return postMessage(request, env, me, messages[1])
  }

  return json({ error: 'not_found' }, 404)
}

/** Cron: rooms whose activity has ended take their messages with them. */
export async function sweepRooms(env: Env): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM room_messages WHERE room_id IN (SELECT id FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?)'
    ).bind(now),
    env.DB.prepare(
      'DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?)'
    ).bind(now),
    env.DB.prepare(
      'DELETE FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?'
    ).bind(now),
  ])
}
