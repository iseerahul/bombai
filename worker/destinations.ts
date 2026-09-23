/**
 * Destinations: searching for one, and finding a picture of it.
 *
 * Two small upstream services, both free and keyless, both cached hard in D1
 * because neither is ours to hammer:
 *
 *   Photon           global place search over OpenStreetMap. Typo-tolerant —
 *                    "thail" finds Thailand, "bangko" finds Bangkok — which
 *                    matters when someone is typing a country name they have
 *                    never spelled before.
 *   Wikimedia Commons a photograph of the place.
 *
 * **On pictures.** The obvious route is Wikipedia's page summary, and it is
 * wrong for this: a country's lead image is its *flag*. Thailand returns
 * Flag_of_Thailand, Vietnam returns Flag_of_Vietnam. Nobody plans a holiday
 * looking at a flag. The page's media list is worse again — historical maps
 * and 19th-century paintings. So this searches Commons for the place plus
 * "landscape" and filters out flags, seals, maps and diagrams, which yields
 * actual scenery.
 */

import { type Env, checkRateLimit, json, rateBucket } from './lib'

const PHOTON = 'https://photon.komoot.io/api/'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/'

const UA = 'MumbaiCivicMap/0.1 (student project; trip planning)'

/** Places do not move and their photographs do not go stale. */
const TTL_MS = 90 * 24 * 60 * 60 * 1000

const LIMITS = {
  search: { max: 120, windowMs: 60 * 60 * 1000 },
  image: { max: 60, windowMs: 60 * 60 * 1000 },
} as const

/**
 * Anything that is a symbol rather than a place.
 *
 * Commons is full of flags, coats of arms, locator maps and infographics
 * tagged with the country name. Every one of them would be a terrible photo
 * on a trip card.
 */
const NOT_A_PHOTO =
  /flag|coat[_ ]of[_ ]arms|emblem|locator|location[_ ]map|orthographic|seal[_ ]of|map[_ ]of|\bmap\b|logo|diagram|chart|graph|stamp|postmark|banknote|coin|special[_ ]marker|\.svg/i

export interface DestinationHit {
  name: string
  country: string | null
  /** "country", "city", "town", "state" — what OSM calls it. */
  kind: string | null
  lat: number
  lon: number
}

async function cacheGet(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT payload FROM destination_cache WHERE k = ? AND expires_at > ?'
  )
    .bind(key, Date.now())
    .first<{ payload: string }>()
  return row?.payload ?? null
}

async function cacheSet(env: Env, key: string, payload: string): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO destination_cache (k, payload, created_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET
       payload = excluded.payload,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  )
    .bind(key, payload, now, now + TTL_MS)
    .run()
}

const normalise = (q: string) =>
  q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Type-ahead over the world's cities, towns, states and countries. */
async function searchDestinations(query: string): Promise<DestinationHit[]> {
  const url = new URL(PHOTON)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '8')
  // Without this, Thailand comes back as ประเทศไทย and Japan as 日本 — correct,
  // and useless to someone who typed "thail".
  url.searchParams.set('lang', 'en')
  for (const tag of ['place:country', 'place:city', 'place:town', 'place:state']) {
    url.searchParams.append('osm_tag', tag)
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number] }
        properties?: { name?: string; country?: string; osm_value?: string }
      }[]
    }

    const seen = new Set<string>()
    const out: DestinationHit[] = []
    for (const f of body.features ?? []) {
      const p = f.properties
      const c = f.geometry?.coordinates
      if (!p?.name || !c) continue
      // Photon frequently returns the same place as both city and state.
      const dedupe = `${p.name}|${p.country ?? ''}`.toLowerCase()
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      out.push({
        name: p.name,
        country: p.country && p.country !== p.name ? p.country : null,
        kind: p.osm_value ?? null,
        lat: c[1],
        lon: c[0],
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * A photograph of a place, or null if nothing decent turns up.
 *
 * Wikipedia first, Commons second, and the order matters:
 *
 *   For a **city or region**, Wikipedia's lead image is exactly right — Bangkok
 *   gives a skyline, Goa a beach, Dubai the Burj Khalifa. It is curated by
 *   people who care about that article.
 *
 *   For a **country** it is the flag. Thailand gives Flag_of_Thailand, Vietnam
 *   gives Flag_of_Vietnam, and nobody plans a holiday looking at a flag. So a
 *   flag, seal or map is treated as a miss and the search falls through to
 *   Commons, which does return scenery.
 *
 * Free-text image search was tried first and is worse on its own: "Goa
 * landscape" confidently returns a photograph of Bangsar, in Malaysia.
 */
async function findImage(place: string, country: string | null): Promise<string | null> {
  // --- Wikipedia's lead image ---
  try {
    const res = await fetch(WIKIPEDIA_SUMMARY + encodeURIComponent(place), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const body = (await res.json()) as { thumbnail?: { source?: string } }
      const url = body.thumbnail?.source
      // A flag is a real answer to "picture of Thailand" and the wrong one.
      if (url && !NOT_A_PHOTO.test(url)) return url
    }
  } catch {
    /* fall through */
  }

  // --- Commons, for the countries Wikipedia answers with a flag ---
  const terms = [place, country, 'landscape'].filter(Boolean).join(' ')
  const url = new URL(COMMONS)
  url.searchParams.set('action', 'query')
  url.searchParams.set('generator', 'search')
  url.searchParams.set('gsrsearch', terms)
  url.searchParams.set('gsrnamespace', '6')
  url.searchParams.set('gsrlimit', '20')
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url')
  url.searchParams.set('iiurlwidth', '800')
  url.searchParams.set('format', 'json')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      query?: { pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string }[] }> }
    }
    const hit = Object.values(body.query?.pages ?? {}).find(
      (p) =>
        p.title &&
        /\.(jpe?g|png)$/i.test(p.title) &&
        !NOT_A_PHOTO.test(p.title) &&
        p.imageinfo?.[0]?.thumburl
    )
    return hit?.imageinfo?.[0]?.thumburl ?? null
  } catch {
    return null
  }
}

export async function routeDestinations(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  // --- type-ahead ---
  if (url.pathname === '/api/destinations' && request.method === 'GET') {
    const query = (url.searchParams.get('q') ?? '').trim()
    if (query.length < 2) return json({ results: [] })

    const key = `s:${normalise(query)}`
    const cached = await cacheGet(env, key)
    if (cached) {
      try {
        return json({ results: JSON.parse(cached), cached: true })
      } catch {
        /* corrupt row; re-fetch */
      }
    }

    const limit = await checkRateLimit(
      env,
      await rateBucket(request, env, 'dest-search'),
      LIMITS.search
    )
    if (!limit.ok) return json({ results: [], error: 'rate_limited' }, 429)

    const results = await searchDestinations(query)
    await cacheSet(env, key, JSON.stringify(results))
    return json({ results })
  }

  // --- picture ---
  if (url.pathname === '/api/destination-image' && request.method === 'GET') {
    const place = (url.searchParams.get('q') ?? '').trim()
    const country = (url.searchParams.get('country') ?? '').trim() || null
    if (place.length < 2 || place.length > 80) return json({ imageUrl: null })

    const key = `i:${normalise(place)}|${normalise(country ?? '')}`
    const cached = await cacheGet(env, key)
    // An empty string is a cached "we looked and found nothing" — worth
    // remembering, or every render retries a search that already failed.
    if (cached !== null) return json({ imageUrl: cached || null, cached: true })

    const limit = await checkRateLimit(
      env,
      await rateBucket(request, env, 'dest-image'),
      LIMITS.image
    )
    if (!limit.ok) return json({ imageUrl: null, error: 'rate_limited' }, 429)

    const imageUrl = await findImage(place, country)
    await cacheSet(env, key, imageUrl ?? '')
    return json({ imageUrl })
  }

  return null
}
