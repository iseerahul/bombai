/**
 * Seeded events: recurring nights at known Mumbai venues.
 *
 * This exists because the other two sources have real gaps — Ticketmaster's
 * India coverage is thin, and the community board is empty until people post.
 * A city app that shows nothing on opening night teaches people not to come
 * back.
 *
 * HONESTY REQUIREMENTS, and they are not optional:
 *   - These are marked `source: 'seed'` and the UI labels them, so nobody
 *     mistakes them for a live ticketed listing.
 *   - They carry NO ticket URL and NO price, because we do not know either.
 *     A fabricated "₹500" or a made-up booking link would be worse than an
 *     empty board.
 *   - Venues and their recurring nights are hand-compiled and go stale. Treat
 *     this as a starting seed, verify before any public launch, and delete an
 *     entry the moment it stops being true.
 */

import type { Env } from './lib'

interface Recurring {
  title: string
  /** 0 = Sunday. */
  weekday: number
  /** Local start hour, 24h. */
  hour: number
  minute: number
  durationH: number
  category: string
  venueName: string
  lat: number
  lon: number
  note: string
}

/**
 * Approximate venue coordinates (±100-200 m). Good enough to place a pin in
 * the right block; verify before relying on them.
 */
const RECURRING: Recurring[] = [
  {
    title: 'Open mic night',
    weekday: 2,
    hour: 20,
    minute: 30,
    durationH: 3,
    category: 'comedy',
    venueName: 'antiSOCIAL, Khar',
    lat: 19.0707,
    lon: 72.8347,
    note: 'Long-running weekly open mic. Turn up early for a slot.',
  },
  {
    title: 'Live indie sets',
    weekday: 5,
    hour: 21,
    minute: 0,
    durationH: 4,
    category: 'music',
    venueName: 'The Habitat, Khar',
    lat: 19.0725,
    lon: 72.8385,
    note: 'Independent music and comedy most weekends.',
  },
  {
    title: 'Jazz evening',
    weekday: 4,
    hour: 21,
    minute: 30,
    durationH: 3,
    category: 'music',
    venueName: 'The Quarter, Fort',
    lat: 18.9297,
    lon: 72.8324,
    note: 'Live jazz and cabaret at the Royal Opera House end of town.',
  },
  {
    title: 'Sunday farmers market',
    weekday: 0,
    hour: 9,
    minute: 0,
    durationH: 4,
    category: 'food',
    venueName: 'Maker Maxity, BKC',
    lat: 19.0662,
    lon: 72.8697,
    note: 'Produce, bakers and small food stalls.',
  },
  {
    title: 'Sunset drum circle',
    weekday: 6,
    hour: 17,
    minute: 30,
    durationH: 2,
    category: 'music',
    venueName: 'Carter Road Promenade, Bandra',
    lat: 19.0625,
    lon: 72.8204,
    note: 'Informal, free, on the promenade. Bring something to sit on.',
  },
  {
    title: 'Morning park run',
    weekday: 6,
    hour: 6,
    minute: 30,
    durationH: 1,
    category: 'sport',
    venueName: 'Shivaji Park, Dadar',
    lat: 19.0286,
    lon: 72.8397,
    note: 'Free community run. All paces.',
  },
  {
    title: 'Gallery late night',
    weekday: 4,
    hour: 18,
    minute: 30,
    durationH: 3,
    category: 'arts',
    venueName: 'Kala Ghoda art district',
    lat: 18.9281,
    lon: 72.8319,
    note: 'Several galleries stay open late; most are free to walk into.',
  },
  {
    title: 'Book club meet',
    weekday: 3,
    hour: 19,
    minute: 0,
    durationH: 2,
    category: 'arts',
    venueName: 'Title Waves, Bandra',
    lat: 19.0653,
    lon: 72.8336,
    note: 'Regular reading group at the bookshop.',
  },
]

/** Next occurrence of `weekday` at the given local time, strictly in the future. */
function nextOccurrence(from: Date, weekday: number, hour: number, minute: number): Date {
  const d = new Date(from)
  d.setHours(hour, minute, 0, 0)
  let delta = (weekday - d.getDay() + 7) % 7
  if (delta === 0 && d.getTime() <= from.getTime()) delta = 7
  d.setDate(d.getDate() + delta)
  return d
}

/**
 * Materialise the next few weeks of each recurring night.
 * Idempotent: the external id encodes the date, so re-running updates in place.
 */
export async function seedEvents(env: Env, weeks = 3): Promise<number> {
  const now = new Date()
  const statements = []

  for (const r of RECURRING) {
    for (let week = 0; week < weeks; week++) {
      const start = nextOccurrence(now, r.weekday, r.hour, r.minute)
      start.setDate(start.getDate() + week * 7)

      const startsAt = start.getTime()
      const endsAt = startsAt + r.durationH * 60 * 60 * 1000
      const externalId = `${r.venueName}|${r.title}|${start.toISOString().slice(0, 10)}`

      statements.push(
        env.DB.prepare(
          `INSERT INTO events
             (id, source, external_id, creator_id, title, description, category, emoji,
              venue_name, address, lat, lon, starts_at, ends_at,
              price_min, price_max, currency, ticket_url, image_url, created_at, expires_at)
           VALUES (?, 'seed', ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, 'INR', NULL, NULL, ?, ?)
           ON CONFLICT(source, external_id) DO UPDATE SET
             starts_at = excluded.starts_at, ends_at = excluded.ends_at,
             expires_at = excluded.expires_at`
        ).bind(
          crypto.randomUUID(),
          externalId,
          r.title,
          r.note,
          r.category,
          { music: '🎵', sport: '🏟️', arts: '🎭', comedy: '🎤', food: '🍽️' }[r.category] ??
            '🎫',
          r.venueName,
          r.lat,
          r.lon,
          startsAt,
          endsAt,
          Date.now(),
          endsAt + 24 * 60 * 60 * 1000
        )
      )
    }
  }

  // D1 batches are capped; chunk rather than sending one enormous batch.
  for (let i = 0; i < statements.length; i += 40) {
    await env.DB.batch(statements.slice(i, i + 40))
  }

  return statements.length
}
