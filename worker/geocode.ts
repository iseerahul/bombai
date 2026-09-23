/**
 * Name search for everything we did not bake into the corpus.
 *
 * The shipped GeoJSON covers fifteen categories. OpenStreetMap has hundreds.
 * Kitab Khana is `shop=books`; a salon is `shop=hairdresser`; a gym chain is
 * `leisure=fitness_centre` but the one you mean might be tagged
 * `amenity=gym` by whoever mapped it. There is no category list that closes
 * that gap — the tail is the whole point of a tail — so when local search finds
 * nothing by name, we ask a geocoder that has all of OSM.
 *
 * This runs server-side rather than from the browser for three reasons: the
 * Nominatim usage policy wants a real identifying User-Agent and a low request
 * rate, results must be cached rather than re-fetched, and keeping it here
 * means swapping to a self-hosted instance or a paid provider later is one
 * file rather than a client release.
 *
 * It is a **fallback**, not the search path. The local index answers first and
 * instantly; this only runs when that came back empty, which keeps the request
 * rate proportional to genuine misses.
 */

import { type Env, SERVICE_BBOX, checkRateLimit, inServiceArea, json, rateBucket } from './lib'

/**
 * Photon first, Nominatim second.
 *
 * Both read the same OpenStreetMap data, but they match differently and it
 * matters a great deal here. Nominatim does exact token matching: it finds
 * "Kitab Khana" and "kitab-khana", and returns nothing at all for
 * "kitabkhana", "kitab khaana" or "prithvi theater". Photon is built for
 * typo-tolerant autocomplete and resolves every one of those to the right
 * place.
 *
 * People type place names from memory, on a phone, one-handed. Missing spaces
 * and near-miss spellings are the normal case, not an edge case, so the
 * forgiving matcher goes first and the strict one is the backstop for when
 * Photon's public instance is unreachable.
 */
const PHOTON = 'https://photon.komoot.io/api/'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/**
 * Identifies the app, as the usage policy requires. A generic browser string
 * here would be a violation, not a clever workaround.
 */
const UA = 'MumbaiCivicMap/0.1 (student project; civic map of Mumbai)'

/** Cached results are good for a month; shops move, but not that fast. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000

const LIMIT = { max: 30, windowMs: 60 * 60 * 1000 }

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    osm_id?: number
    osm_type?: string
    osm_key?: string
    osm_value?: string
    name?: string
    street?: string
    housenumber?: string
    district?: string
    city?: string
    state?: string
  }
}

interface NominatimHit {
  osm_type?: string
  osm_id?: number
  lat?: string
  lon?: string
  name?: string
  display_name?: string
  category?: string
  type?: string
  class?: string
}

export interface GeocodeResult {
  id: string
  name: string
  address: string | null
  lat: number
  lon: number
  /** "shop=books" — same shape the baked data uses. */
  subtype: string | null
  category: string
}

/** Normalised cache key: case, punctuation and spacing shouldn't split rows. */
function cacheKey(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Map an OSM class/type onto one of our categories so the result can carry a
 * colour and an icon. Anything we don't recognise lands in `other`, which is
 * honest — we know where it is and what OSM calls it, and nothing more.
 */
function categoryFor(cls: string, type: string): string {
  if (cls === 'shop') {
    if (['bakery', 'pastry', 'confectionery', 'deli'].includes(type)) return 'food'
    if (['mall', 'department_store'].includes(type)) return 'market'
    if (type === 'chemist') return 'pharmacy'
    return 'other'
  }
  if (cls === 'amenity') {
    if (['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream'].includes(type)) return 'food'
    if (['hospital', 'clinic', 'doctors'].includes(type)) return 'health'
    if (type === 'pharmacy') return 'pharmacy'
    if (type === 'toilets') return 'toilets'
    if (type === 'drinking_water') return 'drinking_water'
    if (type === 'police') return 'police'
    if (['cinema', 'theatre', 'library', 'arts_centre'].includes(type)) return 'culture'
    if (type === 'marketplace') return 'market'
    if (['bus_station', 'ferry_terminal'].includes(type)) return 'transit'
    if (['atm', 'bank'].includes(type)) return 'atm'
    return 'other'
  }
  if (cls === 'leisure') {
    if (['park', 'garden', 'nature_reserve'].includes(type)) return 'park'
    if (['pitch', 'sports_centre', 'fitness_centre', 'stadium', 'playground'].includes(type))
      return 'sports'
    return 'other'
  }
  if (cls === 'tourism') {
    if (['museum', 'gallery', 'artwork', 'attraction'].includes(type)) return 'culture'
    if (type === 'viewpoint') return 'waterfront'
    return 'other'
  }
  if (cls === 'natural' && type === 'beach') return 'waterfront'
  if (cls === 'railway' || cls === 'public_transport') return 'transit'
  if (cls === 'healthcare') return 'health'
  return 'other'
}

function shape(hit: NominatimHit): GeocodeResult | null {
  const lat = Number(hit.lat)
  const lon = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (!inServiceArea(lat, lon)) return null

  const cls = hit.class ?? hit.category ?? ''
  const type = hit.type ?? ''
  // Nominatim puts the short name in `name` and the full postal string in
  // `display_name`; the first comma-separated part is the usable label.
  const label = (hit.name ?? hit.display_name?.split(',')[0] ?? '').trim()
  if (!label) return null

  const id =
    hit.osm_type && hit.osm_id
      ? `osm:${hit.osm_type}/${hit.osm_id}`
      : `geo:${lat.toFixed(5)},${lon.toFixed(5)}`

  return {
    id,
    name: label.slice(0, 120),
    address: hit.display_name ? hit.display_name.slice(0, 200) : null,
    lat,
    lon,
    subtype: cls && type ? `${cls}=${type}` : null,
    category: categoryFor(cls, type),
  }
}

/**
 * Photon: typo-tolerant, bbox-bounded.
 *
 * The bbox is a hard bound rather than a bias. Without it a bad enough typo
 * ("kitabkana") happily answers with a town in Japan, because the matcher is
 * forgiving enough to reach that far when nothing closer scores.
 */
async function viaPhoton(query: string): Promise<GeocodeResult[]> {
  const url = new URL(PHOTON)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '10')
  url.searchParams.set(
    'bbox',
    `${SERVICE_BBOX.west},${SERVICE_BBOX.south},${SERVICE_BBOX.east},${SERVICE_BBOX.north}`
  )
  // Centre bias, so the closest of several same-named places wins.
  url.searchParams.set('lat', String((SERVICE_BBOX.north + SERVICE_BBOX.south) / 2))
  url.searchParams.set('lon', String((SERVICE_BBOX.east + SERVICE_BBOX.west) / 2))

  try {
    const res = await fetch(url.toString(), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as { features?: PhotonFeature[] }
    const out: GeocodeResult[] = []

    for (const f of body.features ?? []) {
      const coords = f.geometry?.coordinates
      const p = f.properties
      if (!coords || !p) continue
      const [lon, lat] = coords
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      // Photon honours bbox loosely; re-check rather than trust it.
      if (!inServiceArea(lat, lon)) continue

      const label = (p.name ?? '').trim()
      if (!label) continue

      const cls = p.osm_key ?? ''
      const type = p.osm_value ?? ''
      // Photon abbreviates the type to a single letter.
      const osmType = { N: 'node', W: 'way', R: 'relation' }[p.osm_type ?? ''] ?? null

      const address = [p.housenumber, p.street, p.district, p.city]
        .filter(Boolean)
        .join(', ')

      out.push({
        id:
          osmType && p.osm_id
            ? `osm:${osmType}/${p.osm_id}`
            : `geo:${lat.toFixed(5)},${lon.toFixed(5)}`,
        name: label.slice(0, 120),
        address: address ? address.slice(0, 200) : null,
        lat,
        lon,
        subtype: cls && type ? `${cls}=${type}` : null,
        category: categoryFor(cls, type),
      })
    }
    return out
  } catch {
    return []
  }
}

/** The strict backstop, for when Photon's public instance is unreachable. */
async function viaNominatim(query: string): Promise<GeocodeResult[]> {
  const url = new URL(NOMINATIM)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '8')
  url.searchParams.set('addressdetails', '0')
  url.searchParams.set(
    'viewbox',
    `${SERVICE_BBOX.west},${SERVICE_BBOX.north},${SERVICE_BBOX.east},${SERVICE_BBOX.south}`
  )
  url.searchParams.set('bounded', '1')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const hits = (await res.json()) as NominatimHit[]
    return hits.map(shape).filter((r): r is GeocodeResult => r !== null)
  } catch {
    return []
  }
}

export async function routeGeocode(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (url.pathname !== '/api/geocode' || request.method !== 'GET') return null

  const query = (url.searchParams.get('q') ?? '').trim()
  if (query.length < 2 || query.length > 100) {
    return json({ results: [] })
  }

  const key = cacheKey(query)
  const now = Date.now()

  // --- cache ---
  const cached = await env.DB.prepare(
    'SELECT payload FROM geocode_cache WHERE q = ? AND expires_at > ?'
  )
    .bind(key, now)
    .first<{ payload: string }>()

  if (cached) {
    try {
      return json({ results: JSON.parse(cached.payload), cached: true })
    } catch {
      // A corrupt row is not worth failing over; fall through and re-fetch.
    }
  }

  // Rate limit only on a cache miss — repeats cost us nothing upstream.
  const limit = await checkRateLimit(env, await rateBucket(request, env, 'geocode'), LIMIT)
  if (!limit.ok) return json({ error: 'rate_limited', results: [] }, 429)

  let results = await viaPhoton(query)
  // Only fall back when Photon gave nothing at all — a thin result set is a
  // real answer, not a failure.
  if (!results.length) results = await viaNominatim(query)

  await env.DB.prepare(
    `INSERT INTO geocode_cache (q, payload, created_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(q) DO UPDATE SET
       payload = excluded.payload,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  )
    .bind(key, JSON.stringify(results), now, now + TTL_MS)
    .run()

  return json({ results })
}
