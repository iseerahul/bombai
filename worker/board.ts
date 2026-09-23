/**
 * The board: visits (private) and spots (public).
 *
 * The invariant this file exists to hold: **no endpoint here ever returns one
 * person's visits to anyone else.** `visits` is read only with
 * `WHERE user_id = ?` against the authenticated session, always. What becomes
 * public is a `spot` — a place, its category, its aggregated tags — and that is
 * created by a separate deliberate act, carrying none of the visit's date,
 * note, or ownership.
 *
 * Photos live in R2, never in D1. D1 holds the object key and the dimensions;
 * the bytes are fetched from the bucket. At 300 KB a photo, putting them in a
 * 5 GB SQLite database would exhaust it in about 16,000 uploads and make every
 * query slower in the meantime.
 */

import { type Env, checkRateLimit, inServiceArea, json, rateBucket } from './lib'
import { type User, currentUser, requireUser } from './auth'

const UUID = '[0-9a-fA-F-]{36}'

const LIMITS = {
  visit: { max: 60, windowMs: 60 * 60 * 1000 },
  photo: { max: 120, windowMs: 60 * 60 * 1000 },
  tag: { max: 200, windowMs: 60 * 60 * 1000 },
} as const

/** Matches the client's own resize ceiling, with headroom for a stray re-encode. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const MAX_PHOTOS_PER_VISIT = 6

/**
 * How many independent people must vouch for a spot before it is recommended
 * to strangers. Below this it is visible to its author and returned with its
 * count attached, never presented as established.
 */
export const TRUSTED_AT = 3

interface VisitRow {
  id: string
  user_id: string
  poi_id: string | null
  spot_id: string | null
  label: string
  lat: number
  lon: number
  category: string | null
  visited_at: number
  note: string | null
  tags: string
  published: number
  created_at: number
}

interface PhotoRow {
  id: string
  visit_id: string
  obj_key: string
  width: number | null
  height: number | null
  created_at: number
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string').slice(0, 12) : []
  } catch {
    return []
  }
}

function shapeVisit(row: VisitRow, photos: PhotoRow[]) {
  return {
    id: row.id,
    poiId: row.poi_id,
    spotId: row.spot_id,
    label: row.label,
    lat: row.lat,
    lon: row.lon,
    category: row.category,
    visitedAt: row.visited_at,
    note: row.note,
    tags: parseTags(row.tags),
    published: row.published === 1,
    createdAt: row.created_at,
    photos: photos
      .filter((p) => p.visit_id === row.id)
      .map((p) => ({
        id: p.id,
        url: `/api/photo/${p.id}`,
        width: p.width ?? 0,
        height: p.height ?? 0,
        byId: null,
        byName: null,
        createdAt: p.created_at,
      })),
  }
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

async function listVisits(env: Env, user: User): Promise<Response> {
  const { results: rows } = await env.DB.prepare(
    'SELECT * FROM visits WHERE user_id = ? ORDER BY visited_at DESC LIMIT 500'
  )
    .bind(user.id)
    .all<VisitRow>()

  const visits = rows ?? []
  if (!visits.length) return json({ visits: [] })

  // One join rather than a query per visit.
  const { results: photos } = await env.DB.prepare(
    `SELECT p.* FROM visit_photos p
       JOIN visits v ON v.id = p.visit_id
      WHERE v.user_id = ?`
  )
    .bind(user.id)
    .all<PhotoRow>()

  return json({ visits: visits.map((v) => shapeVisit(v, photos ?? [])) })
}

async function createVisit(request: Request, env: Env, user: User): Promise<Response> {
  const limit = await checkRateLimit(env, await rateBucket(request, env, 'visit'), LIMITS.visit)
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const label = String(body.label ?? '').trim().slice(0, 120)
  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (!label) return json({ error: 'bad_label' }, 400)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'bad_coords' }, 400)
  if (!inServiceArea(lat, lon)) return json({ error: 'outside_service_area' }, 400)

  const now = Date.now()
  const visitedAt = Number(body.visitedAt)
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 12)
    : []

  const id = crypto.randomUUID()
  const publish = body.publishAsSpot === true

  await env.DB.prepare(
    `INSERT INTO visits
       (id, user_id, poi_id, spot_id, label, lat, lon, category,
        visited_at, note, tags, published, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      typeof body.poiId === 'string' ? body.poiId : null,
      typeof body.spotId === 'string' ? body.spotId : null,
      label,
      lat,
      lon,
      typeof body.category === 'string' ? body.category : null,
      // A visit in the future is a typo, not a memory.
      Number.isFinite(visitedAt) && visitedAt <= now + 86_400_000 ? visitedAt : now,
      typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null,
      JSON.stringify(tags),
      publish ? 1 : 0,
      now
    )
    .run()

  let spotId: string | null = null
  if (publish) spotId = await publishAsSpot(env, user, { label, lat, lon, tags, body, now })

  return json({ id, spotId }, 201)
}

/**
 * Turn a visit into a public spot, or attach to one that already exists.
 *
 * Two people marking the same bench should produce one spot with two
 * confirmations, not two spots 15 m apart — so an existing spot within
 * `NEAR_M` with a compatible name is confirmed rather than duplicated.
 */
const NEAR_M = 80

async function publishAsSpot(
  env: Env,
  user: User,
  input: {
    label: string
    lat: number
    lon: number
    tags: string[]
    body: Record<string, unknown>
    now: number
  }
): Promise<string> {
  const { label, lat, lon, tags, body, now } = input

  // Rough degree box; refined by the distance check below.
  const dLat = NEAR_M / 111_000
  const dLon = NEAR_M / 105_000
  const { results: near } = await env.DB.prepare(
    `SELECT id, name, lat, lon FROM spots
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND status = 'visible'`
  )
    .bind(lat - dLat, lat + dLat, lon - dLon, lon + dLon)
    .all<{ id: string; name: string; lat: number; lon: number }>()

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const match = (near ?? []).find((s) => {
    const metres = Math.hypot((s.lat - lat) * 111_000, (s.lon - lon) * 105_000)
    if (metres > NEAR_M) return false
    const a = norm(s.name)
    const b = norm(label)
    return a === b || a.startsWith(b) || b.startsWith(a)
  })

  let spotId: string
  if (match) {
    spotId = match.id
    const already = await env.DB.prepare(
      'SELECT 1 AS hit FROM spot_confirmations WHERE spot_id = ? AND user_id = ?'
    )
      .bind(spotId, user.id)
      .first<{ hit: number }>()
    if (!already) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO spot_confirmations (spot_id, user_id, created_at) VALUES (?, ?, ?)'
        ).bind(spotId, user.id, now),
        env.DB.prepare(
          'UPDATE spots SET confirmations = confirmations + 1, last_confirmed_at = ? WHERE id = ?'
        ).bind(now, spotId),
      ])
    }
  } else {
    spotId = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO spots (id, name, lat, lon, category, note, added_by,
                            created_at, confirmations, last_confirmed_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'visible')`
      ).bind(
        spotId,
        label,
        lat,
        lon,
        typeof body.category === 'string' ? body.category : 'other',
        /*
         * NOT `body.note`. That is the visit's private journal entry and must
         * never cross into the public row — a note like "quiet on weekday
         * mornings" is fine to share, but "met R here" is not, and the writer
         * chose which they were writing when they typed it into a private
         * field. A public description is a separate, deliberate field.
         */
        typeof body.spotNote === 'string' ? body.spotNote.trim().slice(0, 300) || null : null,
        user.id,
        now,
        now
      ),
      env.DB.prepare(
        'INSERT INTO spot_confirmations (spot_id, user_id, created_at) VALUES (?, ?, ?)'
      ).bind(spotId, user.id, now),
    ])
  }

  // The tags are the recommendation signal; one row per person per tag.
  if (tags.length) {
    await env.DB.batch(
      tags.map((tag) =>
        env.DB.prepare(
          `INSERT INTO spot_tags (spot_id, tag, user_id, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(spot_id, tag, user_id) DO NOTHING`
        ).bind(spotId, tag, user.id, now)
      )
    )
  }

  return spotId
}

async function deleteVisit(env: Env, user: User, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT user_id FROM visits WHERE id = ?')
    .bind(id)
    .first<{ user_id: string }>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (row.user_id !== user.id) return json({ error: 'not_yours' }, 403)

  const { results: photos } = await env.DB.prepare(
    'SELECT obj_key FROM visit_photos WHERE visit_id = ?'
  )
    .bind(id)
    .all<{ obj_key: string }>()

  // Bytes first: an orphaned row is recoverable, an orphaned object is not.
  for (const p of photos ?? []) {
    try {
      await env.PHOTOS?.delete(p.obj_key)
    } catch {
      /* the row still goes, and the sweep will not miss it again */
    }
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM visit_photos WHERE visit_id = ?').bind(id),
    env.DB.prepare('DELETE FROM visits WHERE id = ?').bind(id),
  ])
  return json({ deleted: true })
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

async function uploadPhoto(
  request: Request,
  env: Env,
  user: User,
  visitId: string
): Promise<Response> {
  if (!env.PHOTOS) return json({ error: 'photo_storage_unconfigured' }, 503)

  const limit = await checkRateLimit(env, await rateBucket(request, env, 'photo'), LIMITS.photo)
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  const owner = await env.DB.prepare('SELECT user_id FROM visits WHERE id = ?')
    .bind(visitId)
    .first<{ user_id: string }>()
  if (!owner) return json({ error: 'not_found' }, 404)
  if (owner.user_id !== user.id) return json({ error: 'not_yours' }, 403)

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM visit_photos WHERE visit_id = ?'
  )
    .bind(visitId)
    .first<{ n: number }>()
  if ((count?.n ?? 0) >= MAX_PHOTOS_PER_VISIT) return json({ error: 'too_many_photos' }, 400)

  const type = request.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) return json({ error: 'not_an_image' }, 400)

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength === 0) return json({ error: 'empty' }, 400)
  if (bytes.byteLength > MAX_PHOTO_BYTES) return json({ error: 'too_large' }, 413)

  const id = crypto.randomUUID()
  const objKey = `photos/${user.id}/${id}.jpg`
  const now = Date.now()

  await env.PHOTOS.put(objKey, bytes, {
    httpMetadata: {
      contentType: 'image/jpeg',
      // Content-addressed by a random id, so it can never change under a URL.
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  const width = Number(request.headers.get('x-image-width'))
  const height = Number(request.headers.get('x-image-height'))

  await env.DB.prepare(
    `INSERT INTO visit_photos (id, visit_id, user_id, obj_key, width, height, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      visitId,
      user.id,
      objKey,
      Number.isFinite(width) ? width : null,
      Number.isFinite(height) ? height : null,
      bytes.byteLength,
      now
    )
    .run()

  return json({ id, url: `/api/photo/${id}` }, 201)
}

/**
 * Serve one photo.
 *
 * Immutable and cached for a year, so a given photo costs one request per
 * browser cache rather than one per page view. In production these should be
 * served from an R2 public bucket on its own hostname instead, which takes the
 * Worker out of the path entirely — at any real scale, image requests dwarf
 * API requests, and Workers have a daily request budget while R2 egress is free.
 */
async function servePhoto(env: Env, id: string): Promise<Response> {
  if (!env.PHOTOS) return json({ error: 'photo_storage_unconfigured' }, 503)

  const row = await env.DB.prepare('SELECT obj_key FROM visit_photos WHERE id = ?')
    .bind(id)
    .first<{ obj_key: string }>()
  if (!row) return json({ error: 'not_found' }, 404)

  const object = await env.PHOTOS.get(row.obj_key)
  if (!object) return json({ error: 'not_found' }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

/**
 * Public spots, with their aggregated tags.
 *
 * `tagCounts` is what the ranker consumes: a tag with eight people behind it is
 * a real signal in a way that no OSM field could supply, which is exactly the
 * gap this feature exists to fill.
 */
async function listSpots(env: Env, user: User | null): Promise<Response> {
  const { results: spots } = await env.DB.prepare(
    `SELECT * FROM spots WHERE status = 'visible'
      ORDER BY confirmations DESC, created_at DESC LIMIT 500`
  ).all<{
    id: string
    name: string
    lat: number
    lon: number
    category: string
    note: string | null
    added_by: string | null
    created_at: number
    confirmations: number
    last_confirmed_at: number | null
  }>()

  const rows = spots ?? []
  if (!rows.length) return json({ spots: [], trustedAt: TRUSTED_AT })

  const { results: tags } = await env.DB.prepare(
    `SELECT t.spot_id, t.tag, COUNT(*) AS n
       FROM spot_tags t JOIN spots s ON s.id = t.spot_id
      WHERE s.status = 'visible'
      GROUP BY t.spot_id, t.tag`
  ).all<{ spot_id: string; tag: string; n: number }>()

  const bySpot = new Map<string, Record<string, number>>()
  for (const t of tags ?? []) {
    const bucket = bySpot.get(t.spot_id) ?? {}
    bucket[t.tag] = t.n
    bySpot.set(t.spot_id, bucket)
  }

  let mine = new Set<string>()
  if (user) {
    const { results } = await env.DB.prepare(
      'SELECT spot_id FROM spot_confirmations WHERE user_id = ?'
    )
      .bind(user.id)
      .all<{ spot_id: string }>()
    mine = new Set((results ?? []).map((r) => r.spot_id))
  }

  return json({
    trustedAt: TRUSTED_AT,
    spots: rows.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      category: s.category,
      note: s.note,
      tagCounts: bySpot.get(s.id) ?? {},
      photos: [],
      confirmations: s.confirmations,
      confirmedByMe: mine.has(s.id),
      addedById: s.added_by,
      addedByName: null,
      createdAt: s.created_at,
      lastConfirmedAt: s.last_confirmed_at,
    })),
  })
}

async function confirmSpot(env: Env, user: User, spotId: string): Promise<Response> {
  const spot = await env.DB.prepare("SELECT id FROM spots WHERE id = ? AND status = 'visible'")
    .bind(spotId)
    .first<{ id: string }>()
  if (!spot) return json({ error: 'not_found' }, 404)

  const already = await env.DB.prepare(
    'SELECT 1 AS hit FROM spot_confirmations WHERE spot_id = ? AND user_id = ?'
  )
    .bind(spotId, user.id)
    .first<{ hit: number }>()
  if (already) return json({ confirmed: true, alreadyDone: true })

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO spot_confirmations (spot_id, user_id, created_at) VALUES (?, ?, ?)'
    ).bind(spotId, user.id, now),
    env.DB.prepare(
      'UPDATE spots SET confirmations = confirmations + 1, last_confirmed_at = ? WHERE id = ?'
    ).bind(now, spotId),
  ])
  return json({ confirmed: true })
}

async function tagSpot(
  request: Request,
  env: Env,
  user: User,
  spotId: string
): Promise<Response> {
  const limit = await checkRateLimit(env, await rateBucket(request, env, 'spot-tag'), LIMITS.tag)
  if (!limit.ok) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const tag = String(body.tag ?? '').trim().toLowerCase().slice(0, 32)
  if (!/^[a-z_]{2,32}$/.test(tag)) return json({ error: 'bad_tag' }, 400)

  const spot = await env.DB.prepare("SELECT id FROM spots WHERE id = ? AND status = 'visible'")
    .bind(spotId)
    .first<{ id: string }>()
  if (!spot) return json({ error: 'not_found' }, 404)

  if (body.remove === true) {
    await env.DB.prepare('DELETE FROM spot_tags WHERE spot_id = ? AND tag = ? AND user_id = ?')
      .bind(spotId, tag, user.id)
      .run()
    return json({ tagged: false })
  }

  await env.DB.prepare(
    `INSERT INTO spot_tags (spot_id, tag, user_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(spot_id, tag, user_id) DO NOTHING`
  )
    .bind(spotId, tag, user.id, Date.now())
    .run()
  return json({ tagged: true })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function routeBoard(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  const path = url.pathname
  const isBoard =
    path.startsWith('/api/visits') ||
    path.startsWith('/api/spots') ||
    path.startsWith('/api/photo/')
  if (!isBoard) return null

  const user = await currentUser(request, env)

  // Photos are public by URL: the id is an unguessable UUID, and they are
  // embedded in pages the owner may share.
  const photo = path.match(/^\/api\/photo\/([0-9a-fA-F-]{36})$/)
  if (photo && request.method === 'GET') return servePhoto(env, photo[1])

  // Browsing spots needs no account, the same as every other read in the app.
  if (path === '/api/spots' && request.method === 'GET') return listSpots(env, user)

  const denied = requireUser(user)
  if (denied) return denied
  const me = user as User

  if (path === '/api/visits') {
    if (request.method === 'GET') return listVisits(env, me)
    if (request.method === 'POST') return createVisit(request, env, me)
  }

  const photoUpload = path.match(new RegExp(`^/api/visits/(${UUID})/photo$`))
  if (photoUpload && request.method === 'POST') {
    return uploadPhoto(request, env, me, photoUpload[1])
  }

  const remove = path.match(new RegExp(`^/api/visits/(${UUID})/delete$`))
  if (remove && request.method === 'POST') return deleteVisit(env, me, remove[1])

  const confirm = path.match(new RegExp(`^/api/spots/(${UUID})/confirm$`))
  if (confirm && request.method === 'POST') return confirmSpot(env, me, confirm[1])

  const tag = path.match(new RegExp(`^/api/spots/(${UUID})/tag$`))
  if (tag && request.method === 'POST') return tagSpot(request, env, me, tag[1])

  return json({ error: 'not_found' }, 404)
}
