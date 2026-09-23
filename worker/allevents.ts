/**
 * AllEvents — the paid and ticketed half of Mumbai's event scene.
 *
 * Luma covers meetups and the tech scene; it does not cover the touring comedy
 * show, the Kathak recital, the heritage walk or the stadium gig. AllEvents
 * aggregates those, and publishes every listing as **schema.org `Event`
 * JSON-LD** — the structured format whose entire purpose is to be read by
 * machines rather than by eyes. We parse that block, not the page's markup, so
 * a redesign of their site cannot break us and we take nothing that was not
 * deliberately published for consumption.
 *
 * Permission was checked, not assumed. Their robots.txt sets no Crawl-delay for
 * general agents and disallows none of the city category pages we read (only
 * `/manage/*`, `/go.php`, some `?ref=` query forms and pre-2019 archives). We
 * still pace requests and send an identifying User-Agent.
 *
 * **The listing pages carry a date but no clock time.** The detail page for an
 * event does have one, but fetching 130-odd detail pages per refresh would be
 * an abuse of a service that has been perfectly reasonable with us. So we
 * import the date and record that the time is unknown, and the UI says "time
 * unknown" rather than silently rendering midnight. A wrong time sends someone
 * across Mumbai to a locked door; an absent one sends them to the listing.
 */

import { type Env, inServiceArea } from './lib'
import { categoriseLuma } from './luma'

const UA = 'Mozilla/5.0 (compatible; MumbaiCivicMap/0.1; student project; +contact via app)'

/** Milliseconds between requests. Nothing here is urgent. */
const PAUSE_MS = 1200

/**
 * The city pages we read, and what each one means.
 *
 * The page a listing appears on is a far better category signal than guessing
 * from its title, so we use it directly. `all` has no category of its own and
 * falls back to keyword matching.
 */
const PAGES: { path: string; category: string | null }[] = [
  { path: 'all', category: null },
  // Nightlife was previously folded into music, which buried it — a club night
  // and a classical recital are not the same plan.
  { path: 'parties', category: 'nightlife' },
  { path: 'clubs', category: 'nightlife' },
  { path: 'music', category: 'music' },
  { path: 'concerts', category: 'music' },
  { path: 'festivals', category: 'festival' },
  { path: 'comedy', category: 'comedy' },
  { path: 'theatre', category: 'arts' },
  { path: 'arts', category: 'arts' },
  { path: 'exhibitions', category: 'arts' },
  { path: 'fashion', category: 'arts' },
  { path: 'food-drinks', category: 'food' },
  { path: 'trips-adventures', category: 'outdoors' },
  { path: 'health-wellness', category: 'wellness' },
  { path: 'sports', category: 'sport' },
  { path: 'workshops', category: 'community' },
  { path: 'singles', category: 'community' },
  { path: 'business', category: 'community' },
]

/** Events with no clock time are pinned to 18:00 IST, and flagged as unknown. */
const ASSUMED_HOUR_IST = 18
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const ASSUMED_DURATION_MS = 3 * 60 * 60 * 1000

interface JsonLdOffer {
  price?: string | number
  lowPrice?: string | number
  highPrice?: string | number
  priceCurrency?: string
}

interface JsonLdEvent {
  '@type'?: string
  name?: string
  url?: string
  image?: string
  startDate?: string
  endDate?: string
  description?: string
  eventAttendanceMode?: string
  location?: {
    name?: string
    address?: { streetAddress?: string; addressLocality?: string }
    geo?: { latitude?: string | number; longitude?: string | number }
  }
  offers?: JsonLdOffer | JsonLdOffer[]
}

export interface AllEventsRow {
  externalId: string
  title: string
  description: string | null
  category: string
  venueName: string
  address: string | null
  lat: number
  lon: number
  startsAt: number
  endsAt: number | null
  timeKnown: boolean
  priceMin: number | null
  priceMax: number | null
  currency: string
  ticketUrl: string
  imageUrl: string | null
}

/** Pull every `application/ld+json` payload out of a page. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(match[1]))
    } catch {
      // A malformed block is skipped rather than failing the whole page.
    }
  }
  return out
}

/** Flatten the blocks down to the `Event` objects inside them. */
export function eventsFromJsonLd(blocks: unknown[]): JsonLdEvent[] {
  const events: JsonLdEvent[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (obj['@type'] === 'Event') events.push(obj as JsonLdEvent)
    if (Array.isArray(obj['@graph'])) visit(obj['@graph'])
  }
  blocks.forEach(visit)
  return events
}

/**
 * Undo HTML entity escaping.
 *
 * The JSON-LD is embedded in an HTML document, so titles arrive carrying
 * `&amp;` and friends. Left alone they show up verbatim on the card.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
}

/** Rupees to paise, tolerating the strings schema.org allows. */
function paise(value: string | number | undefined): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function priceRange(offers: JsonLdEvent['offers']): {
  min: number | null
  max: number | null
  currency: string
} {
  const list = offers ? (Array.isArray(offers) ? offers : [offers]) : []
  let min: number | null = null
  let max: number | null = null
  let currency = 'INR'

  for (const offer of list) {
    if (offer.priceCurrency) currency = offer.priceCurrency
    const low = paise(offer.lowPrice ?? offer.price)
    const high = paise(offer.highPrice ?? offer.price)
    if (low != null) min = min == null ? low : Math.min(min, low)
    if (high != null) max = max == null ? high : Math.max(max, high)
  }
  return { min, max, currency }
}

/**
 * The numeric id AllEvents puts at the end of every event URL.
 *
 * Using it rather than the whole URL means a renamed slug updates the existing
 * row instead of creating a second copy of the same event.
 */
export function externalIdFrom(url: string): string | null {
  const match = url.match(/\/(\d{6,})(?:\?|#|$)/)
  return match ? match[1] : null
}

/** One JSON-LD event to one row, or null if it isn't usable. */
export function normaliseAllEvents(
  raw: JsonLdEvent,
  pageCategory: string | null
): AllEventsRow | null {
  const title = decodeEntities((raw.name ?? '').trim())
  const url = (raw.url ?? '').trim()
  if (title.length < 3 || !url.startsWith('https://')) return null

  // Online-only listings have nothing to put on a map of Mumbai.
  if (raw.eventAttendanceMode?.includes('OnlineEventAttendanceMode')) return null

  const externalId = externalIdFrom(url)
  if (!externalId) return null

  const lat = Number(raw.location?.geo?.latitude)
  const lon = Number(raw.location?.geo?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (!inServiceArea(lat, lon)) return null

  const start = (raw.startDate ?? '').trim()
  if (!start) return null

  // "2026-09-19" carries no time; "2026-09-19T20:00:00+05:30" does.
  const timeKnown = start.includes('T')
  let startsAt: number
  if (timeKnown) {
    startsAt = Date.parse(start)
  } else {
    const midnightUtc = Date.parse(`${start}T00:00:00Z`)
    if (!Number.isFinite(midnightUtc)) return null
    // Pin to a plausible evening hour in IST so the event sorts into its own
    // day rather than the one before. The flag is what the UI actually trusts.
    startsAt = midnightUtc - IST_OFFSET_MS + ASSUMED_HOUR_IST * 60 * 60 * 1000
  }
  if (!Number.isFinite(startsAt)) return null

  const parsedEnd = raw.endDate?.includes('T') ? Date.parse(raw.endDate) : NaN
  const endsAt = Number.isFinite(parsedEnd) && parsedEnd > startsAt ? parsedEnd : null

  // The page it was listed on beats guessing from the title — except when the
  // title shouts "tech", which a generic "business" page would otherwise bury.
  const guessed = categoriseLuma(title, null)
  const category = guessed === 'tech' ? 'tech' : (pageCategory ?? guessed)

  const { min, max, currency } = priceRange(raw.offers)
  const venue = (raw.location?.name ?? '').trim()
  const street = decodeEntities((raw.location?.address?.streetAddress ?? '').trim())

  return {
    externalId,
    title: title.slice(0, 100),
    description: raw.description
      ? decodeEntities(raw.description.trim()).slice(0, 600)
      : null,
    category,
    venueName: decodeEntities(venue || raw.location?.address?.addressLocality || 'Mumbai').slice(
      0,
      120
    ),
    address: street ? street.slice(0, 200) : null,
    lat,
    lon,
    startsAt,
    endsAt,
    timeKnown,
    priceMin: min,
    priceMax: max,
    currency,
    ticketUrl: url,
    imageUrl: raw.image ?? null,
  }
}

async function fetchPage(path: string): Promise<string | null> {
  try {
    const res = await fetch(`https://allevents.in/mumbai/${path}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Read the Mumbai listings and upsert them.
 *
 * Deduplicated by AllEvents' own id before writing, because the same event
 * appears on both `/all` and its category page.
 */
export async function refreshAllEvents(
  env: Env,
  emojiFor: (category: string) => string,
  graceMs: number
): Promise<{ imported: number; error?: string }> {
  const rows = new Map<string, AllEventsRow>()
  let reachedAny = false

  for (const page of PAGES) {
    const html = await fetchPage(page.path)
    if (html) {
      reachedAny = true
      for (const raw of eventsFromJsonLd(extractJsonLd(html))) {
        const row = normaliseAllEvents(raw, page.category)
        // `/all` is read first, so a category page's better label wins.
        if (row) rows.set(row.externalId, row)
      }
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }

  if (!reachedAny) return { imported: 0, error: 'unreachable' }
  if (!rows.size) return { imported: 0 }

  const now = Date.now()
  const statements = []

  for (const row of rows.values()) {
    const end = row.endsAt ?? row.startsAt + ASSUMED_DURATION_MS
    statements.push(
      env.DB.prepare(
        `INSERT INTO events
           (id, source, external_id, creator_id, title, description, category, emoji,
            venue_name, address, lat, lon, starts_at, ends_at, time_known,
            price_min, price_max, currency, ticket_url, image_url, created_at, expires_at)
         VALUES (?, 'allevents', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, external_id) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           category = excluded.category, emoji = excluded.emoji,
           venue_name = excluded.venue_name, address = excluded.address,
           lat = excluded.lat, lon = excluded.lon,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           time_known = excluded.time_known,
           price_min = excluded.price_min, price_max = excluded.price_max,
           currency = excluded.currency, ticket_url = excluded.ticket_url,
           image_url = excluded.image_url, expires_at = excluded.expires_at`
      ).bind(
        crypto.randomUUID(),
        row.externalId,
        row.title,
        row.description,
        row.category,
        emojiFor(row.category),
        row.venueName,
        row.address,
        row.lat,
        row.lon,
        row.startsAt,
        row.endsAt,
        row.timeKnown ? 1 : 0,
        row.priceMin,
        row.priceMax,
        row.currency,
        row.ticketUrl,
        row.imageUrl,
        now,
        end + graceMs
      )
    )
  }

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50))
  }
  return { imported: statements.length }
}
