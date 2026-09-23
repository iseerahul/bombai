/**
 * Luma — the widest legal free source of real Mumbai events.
 *
 * Luma runs a public event-discovery page for each city, backed by a public,
 * unauthenticated JSON endpoint. We read that endpoint directly rather than
 * scraping the HTML: it is the interface the page itself consumes, it needs no
 * key, and nothing in Luma's robots.txt disallows it. One polite request per
 * page, a hard page cap, and a real User-Agent.
 *
 * This is where the tech scene actually lives — JS Mumbai, Swift Mumbai,
 * Ethereum and Solana meetups, AI and startup nights — alongside plenty that
 * isn't tech at all: run clubs, nature walks, board-game evenings, tastings.
 *
 * **On price, we deliberately say less than the feed does.** Every entry in the
 * discovery feed reports `is_free: true` with a null price, including events
 * that plainly are not free (paid summits and conferences). That field is not
 * trustworthy, so we import price as unknown and link to the Luma page where
 * the real number is. Showing "Free" on a paid conference would be a worse
 * failure than showing "Price unknown".
 */

import { type Env, inServiceArea } from './lib'

/** Mumbai, and a radius wide enough to include Thane and Navi Mumbai. */
const CENTRE = { lat: 19.076, lon: 72.877, radiusKm: 80 }

/** Bounded so one refresh can never turn into an unbounded crawl. */
const MAX_PAGES = 6
const PAGE_SIZE = 100
const PAUSE_MS = 500

const UA = 'MumbaiCivicMap/0.1 (student project; public event discovery)'

/** Luma leaves the end time off many events; assume three hours. */
const ASSUMED_DURATION_MS = 3 * 60 * 60 * 1000

interface LumaGeo {
  city?: string
  address?: string
  full_address?: string
  city_state?: string
  place_coordinate?: { latitude?: number; longitude?: number }
}

export interface LumaEntry {
  api_id?: string
  event?: {
    api_id?: string
    name?: string
    url?: string
    start_at?: string
    end_at?: string | null
    cover_url?: string | null
    visibility?: string
    location_type?: string
    coordinate?: { latitude?: number; longitude?: number } | null
    geo_address_info?: LumaGeo | null
  }
  calendar?: { name?: string | null } | null
}

interface LumaPage {
  entries?: LumaEntry[]
  has_more?: boolean
  next_cursor?: string | null
}

/**
 * Guess a category from the event title and its host calendar.
 *
 * The discovery feed carries no category field, so this is keyword matching —
 * honest guesswork, not metadata. Rules are ordered by how specific the signal
 * is: a "Generative AI art workshop" is a tech event whose output is art, and
 * the tech rule is checked first because that is the stronger signal about who
 * the event is for.
 */
const CATEGORY_RULES: { category: string; words: RegExp }[] = [
  {
    category: 'tech',
    words:
      /\b(ai|ml|llm|genai|tech|dev|devs|developer|devcon|code|coding|hack|hackathon|engineer|engineering|software|data|cloud|api|web3|crypto|blockchain|bitcoin|ethereum|ethglobal|solana|defi|dao|nft|multichain|startup|startups|saas|founder|founders|vc|venture|investor|investors|accelerator|incubator|js|javascript|typescript|python|react|swift|android|ios|kubernetes|devops|cyber|robotics|iot|agentic|copilot|neural|builder|builders|nocode)\b|demo day|mixture of experts/i,
  },
  {
    category: 'sport',
    words:
      /\b(run|runs|running|marathon|cyclothon|cycling|ride|yoga|fitness|fitclub|workout|trek|hike|swim|football|cricket|badminton|climbing|pickleball|padel)\b|fit club/i,
  },
  {
    category: 'food',
    words:
      /\b(food|coffee|brew|tasting|dinner|brunch|supper|bake|bakery|cook|cooking|chef|wine|beer|whisky|whiskey|cocktail|kombucha|pizza|restaurant)\b/i,
  },
  {
    category: 'comedy',
    words: /\b(comedy|standup|improv|humour|humor)\b|open mic/i,
  },
  {
    /*
     * Checked before music. A rave and a classical recital are both "music" by
     * any tag you like, but nobody looking for one wants the other — and
     * nightlife was invisible before this, because it all landed in music.
     */
    category: 'nightlife',
    words:
      /(party|parties|rave|clubbing|nightlife|afterparty|edm|techno|bash|cocktails|nightclub|dj)|pool party|night out|after party|ladies night|house party/i,
  },
  {
    category: 'festival',
    words: /(festival|fest|carnival|mela|utsav|parade|funfair)/i,
  },
  {
    category: 'outdoors',
    words:
      /(trek|trekking|hike|hiking|camping|adventure|waterfall|kayak|kayaking|rappelling|expedition|sahyadri|birding|stargazing)|road trip|nature walk/i,
  },
  {
    category: 'wellness',
    words:
      /(wellness|yoga|meditation|mindfulness|retreat|breathwork|healing|pilates|zumba|detox|journaling)|sound bath|ice bath/i,
  },
  {
    category: 'music',
    words:
      /(music|gig|concert|band|jazz|acoustic|jam|choir|rap|unplugged|qawwali|ghazal|symphony|orchestra)|hip hop|open mic/i,
  },
  {
    category: 'arts',
    words:
      /\b(art|arts|gallery|exhibit|exhibition|theatre|theater|film|screening|photography|design|craft|painting|pottery|dance|poetry|literature|book|books|reading)\b/i,
  },
  {
    category: 'community',
    words:
      /\b(meetup|mixer|social|networking|community|walk|game|games|volunteer|circle|hangout|connect|collective|summit|conclave|forum)\b/i,
  },
]

export function categoriseLuma(title: string, host: string | null): string {
  const haystack = `${title} ${host ?? ''}`
  for (const rule of CATEGORY_RULES) {
    if (rule.words.test(haystack)) return rule.category
  }
  return 'other'
}

/**
 * A usable venue label.
 *
 * Luma's `address` is the venue's own name when the host set one ("3 Art
 * House"), and absent for events that carry only a city. We never invent one:
 * an event with no venue text falls back to its area.
 */
function venueLabel(geo: LumaGeo | null): string {
  const address = typeof geo?.address === 'string' ? geo.address.trim() : ''
  if (address) return address.slice(0, 120)
  const cityState = typeof geo?.city_state === 'string' ? geo.city_state.trim() : ''
  return (cityState || 'Mumbai').slice(0, 120)
}

async function fetchPage(cursor: string | null): Promise<LumaPage | null> {
  const url = new URL('https://api.lu.ma/discover/get-paginated-events')
  url.searchParams.set('period', 'future')
  url.searchParams.set('pagination_limit', String(PAGE_SIZE))
  url.searchParams.set('latitude', String(CENTRE.lat))
  url.searchParams.set('longitude', String(CENTRE.lon))
  url.searchParams.set('radius', String(CENTRE.radiusKm))
  if (cursor) url.searchParams.set('pagination_cursor', cursor)

  try {
    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    return (await res.json()) as LumaPage
  } catch {
    return null
  }
}

export interface LumaRow {
  externalId: string
  title: string
  category: string
  venueName: string
  address: string | null
  lat: number
  lon: number
  startsAt: number
  endsAt: number | null
  ticketUrl: string | null
  imageUrl: string | null
}

/** Everything we keep from one feed entry, or null if it isn't usable. */
export function normaliseLuma(entry: LumaEntry): LumaRow | null {
  const e = entry.event
  if (!e) return null
  // Private and invite-only events are not ours to list.
  if (e.visibility && e.visibility !== 'public') return null
  // An online-only event has nothing to put on a map of Mumbai.
  if (e.location_type && e.location_type !== 'offline') return null

  const externalId = e.api_id ?? entry.api_id
  const title = (e.name ?? '').trim()
  if (!externalId || title.length < 3) return null

  const geo = e.geo_address_info ?? null
  const coord = e.coordinate ?? geo?.place_coordinate ?? null
  const lat = Number(coord?.latitude)
  const lon = Number(coord?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (!inServiceArea(lat, lon)) return null

  const startsAt = Date.parse(e.start_at ?? '')
  if (!Number.isFinite(startsAt)) return null

  const parsedEnd = e.end_at ? Date.parse(e.end_at) : NaN
  const endsAt = Number.isFinite(parsedEnd) && parsedEnd > startsAt ? parsedEnd : null

  return {
    externalId,
    title: title.slice(0, 100),
    category: categoriseLuma(title, entry.calendar?.name ?? null),
    venueName: venueLabel(geo),
    address: geo?.full_address ? geo.full_address.slice(0, 200) : null,
    lat,
    lon,
    startsAt,
    endsAt,
    ticketUrl: e.url ? `https://lu.ma/${e.url}` : null,
    imageUrl: e.cover_url ?? null,
  }
}

/**
 * Pull public Mumbai events from Luma and upsert them.
 *
 * Upserts on `(source, external_id)`, so running this repeatedly refreshes
 * times and venues in place rather than piling up duplicates.
 */
export async function refreshLuma(
  env: Env,
  emojiFor: (category: string) => string,
  graceMs: number
): Promise<{ imported: number; error?: string }> {
  const seen = new Map<string, LumaRow>()
  let cursor: string | null = null
  let pages = 0
  let reachedAny = false

  while (pages < MAX_PAGES) {
    const page: LumaPage | null = await fetchPage(cursor)
    if (!page) break
    reachedAny = true
    pages++

    for (const entry of page.entries ?? []) {
      const row = normaliseLuma(entry)
      if (row) seen.set(row.externalId, row)
    }

    if (!page.has_more || !page.next_cursor) break
    cursor = page.next_cursor
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }

  if (!reachedAny) return { imported: 0, error: 'unreachable' }
  if (!seen.size) return { imported: 0 }

  const now = Date.now()
  const statements = []

  for (const row of seen.values()) {
    const end = row.endsAt ?? row.startsAt + ASSUMED_DURATION_MS
    statements.push(
      env.DB.prepare(
        `INSERT INTO events
           (id, source, external_id, creator_id, title, description, category, emoji,
            venue_name, address, lat, lon, starts_at, ends_at,
            price_min, price_max, currency, ticket_url, image_url, created_at, expires_at)
         VALUES (?, 'luma', ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?,
                 NULL, NULL, 'INR', ?, ?, ?, ?)
         ON CONFLICT(source, external_id) DO UPDATE SET
           title = excluded.title, category = excluded.category,
           emoji = excluded.emoji, venue_name = excluded.venue_name,
           address = excluded.address, lat = excluded.lat, lon = excluded.lon,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           ticket_url = excluded.ticket_url, image_url = excluded.image_url,
           expires_at = excluded.expires_at`
      ).bind(
        crypto.randomUUID(),
        row.externalId,
        row.title,
        row.category,
        emojiFor(row.category),
        row.venueName,
        row.address,
        row.lat,
        row.lon,
        row.startsAt,
        row.endsAt,
        row.ticketUrl,
        row.imageUrl,
        now,
        end + graceMs
      )
    )
  }

  // D1 caps how much one batch will carry, so send it in chunks.
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50))
  }
  return { imported: statements.length }
}
