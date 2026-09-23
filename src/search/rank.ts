import type { Poi } from '../types'
import { distanceM, formatDistance } from './localIndex'
import { type Mood, getMood, isPubliclyReachable, moodScore } from './moods'
import { isOpenNow } from './openingHours'

/**
 * Ranking, with an explanation attached to every result.
 *
 * The rule this file exists to enforce: **every component of a score is a fact
 * we can point at.** Distance is measured, the subtype came from OSM, the
 * community signal came from real reports. Nothing here synthesises a rating, a
 * popularity score or a "trending" flag, because we have no data for any of
 * those and inventing one is the failure mode this whole project is built to
 * avoid.
 *
 * The practical consequence is `Ranked.why` — four words under each result
 * saying why it is there. If a result cannot be explained, the scoring is
 * wrong, not the explanation.
 */

const WEIGHTS = {
  mood: 3.0,
  text: 2.2,
  distance: 1.6,
  open: 0.5,
  community: 0.8,
  /** Subtracted from each repeat of a brand already in the results. */
  chain: 0.7,
} as const

/** Distance at which the decay term has fallen to ~1/e. */
const DISTANCE_SCALE_M = 1200

/** Two results closer than this with near-identical names are one place. */
const NEAR_DUPE_M = 120

export interface RankInput {
  pois: Poi[]
  center: { lat: number; lon: number } | null
  /** Mood keys, from `detectMoods` or tapped chips. */
  moods?: string[]
  /** Free text left over after category/locality/mood parsing. */
  text?: string
  limit?: number
  now?: Date
}

export interface Ranked {
  poi: Poi
  /** Name if it has a usable one, otherwise what it is ("Playground"). */
  label: string
  score: number
  /** Short, human, comma-free fragments: ["park", "400 m", "open now"]. */
  why: string[]
  distanceM: number | null
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Name relevance, BM25-flavoured but deliberately simple.
 *
 * A whole-phrase hit beats scattered token hits, and a hit at the start of the
 * name beats one buried in it — "Theobroma Bakery" should outrank "Cafe near
 * Theobroma" for the query "theobroma".
 */
/** Everything that isn't a letter or digit, gone: "Kitab Khana" → "kitabkhana". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Dice coefficient over character trigrams, in 0..1.
 *
 * This is what catches a genuine misspelling rather than a spacing difference
 * — "kitab khaana" against "kitab khana", or "theater" against "theatre".
 * Trigrams rather than edit distance because they are cheap to compute over a
 * few thousand candidates and degrade gracefully on longer names.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 3 || b.length < 3) return 0

  const grams = (s: string) => {
    const out = new Set<string>()
    for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3))
    return out
  }
  const ga = grams(a)
  const gb = grams(b)
  let shared = 0
  for (const g of ga) if (gb.has(g)) shared++
  return (2 * shared) / (ga.size + gb.size)
}

export function textScore(poi: Poi, query: string): number {
  if (!query) return 0
  const q = norm(query)
  if (!q) return 0

  const fields = [
    poi.name ?? '',
    poi.tags.cuisine ?? '',
    poi.tags.operator ?? '',
    poi.tags.description ?? '',
  ].join(' ')
  const haystack = norm(fields)
  if (!haystack) return 0

  if (haystack.startsWith(q)) return 1
  if (haystack.includes(q)) return 0.85

  /*
   * Spacing is not a spelling difference.
   *
   * People type place names from memory on a phone: "kitabkhana", "seaface",
   * "bandrafort". Comparing with every separator stripped makes those match
   * exactly, which they morally are.
   */
  const sq = squash(query)
  const sh = squash(fields)
  if (sq.length >= 4 && sh.includes(sq)) return 0.95

  // A real misspelling: close enough on trigrams counts, scaled by how close.
  if (sq.length >= 5) {
    for (const word of fields.split(/\s+/)) {
      const similarity = trigramSimilarity(sq, squash(word))
      if (similarity >= 0.55) return 0.5 + similarity * 0.35
    }
    // Also compare against the whole name, for multi-word misspellings.
    const whole = trigramSimilarity(sq, sh)
    if (whole >= 0.6) return 0.5 + whole * 0.35
  }

  const tokens = q.split(' ').filter((t) => t.length >= 2)
  if (!tokens.length) return 0
  const hits = tokens.filter((t) => haystack.includes(t)).length
  return (hits / tokens.length) * 0.6
}

/** 1 at the centre, ~0.37 at DISTANCE_SCALE_M, approaching 0 beyond. */
function distanceScore(metres: number): number {
  return Math.exp(-metres / DISTANCE_SCALE_M)
}

/**
 * What the community has said about this place.
 *
 * Positive for recently confirmed working, negative for reported broken. This
 * is the only quality signal in the system that is not a static OSM tag, and it
 * is the one that improves as the app is used.
 */
function communityScore(poi: Poi): number {
  if (!poi.status) return 0
  switch (poi.status.verdict) {
    case 'working':
      return 1
    case 'broken':
      return -1.5
    case 'contested':
      return -0.3
    default:
      return 0
  }
}

/**
 * OSM name fields carry junk: single letters, stray digits, placeholder text a
 * mapper never cleaned up. "nm" is a real garden name in the Mumbai extract.
 */
function isJunkName(name: string): boolean {
  const t = name.trim()
  return t.length < 3 || /^[\d\W]+$/.test(t)
}

/**
 * What to actually show in the list.
 *
 * Half of Mumbai's parks and two-thirds of its sports pitches have no name in
 * OSM, but an unnamed playground 190 m away is still a correct answer to "take
 * the kids out" — so we label it by what it is rather than dropping it or
 * printing "(unnamed)". This is something the deterministic ranker can do that
 * a name-based candidate list could not.
 */
export function displayName(poi: Poi): string {
  if (poi.name && !isJunkName(poi.name)) return poi.name
  const sub = subtypeLabel(poi)
  if (!sub) return 'Unnamed place'
  return sub.charAt(0).toUpperCase() + sub.slice(1)
}

function subtypeLabel(poi: Poi): string | null {
  if (!poi.subtype) return null
  const value = poi.subtype.split('=')[1] ?? ''
  return value ? value.replace(/_/g, ' ') : null
}

export function rank(input: RankInput): Ranked[] {
  const { pois, center, text = '', limit = 20, now = new Date() } = input
  const moods = (input.moods ?? []).map(getMood).filter((m): m is Mood => m !== null)

  const scored: Ranked[] = []

  for (const poi of pois) {
    // A place you cannot walk into is not a recommendation.
    if (!isPubliclyReachable(poi)) continue

    const why: string[] = []
    let score = 0

    // --- mood ---------------------------------------------------------------
    if (moods.length) {
      let best = 0
      let bestMood: Mood | null = null
      for (const mood of moods) {
        const m = moodScore(poi, mood)
        if (m > best) {
          best = m
          bestMood = mood
        }
      }
      // A mood is a whitelist. No match means this place is not an answer to
      // the question that was asked, however close it happens to be.
      if (best === 0) continue
      score += WEIGHTS.mood * best
      const label = subtypeLabel(poi) ?? bestMood?.label.toLowerCase() ?? null
      if (label) why.push(label)
    } else {
      const label = subtypeLabel(poi)
      if (label) why.push(label)
    }

    // --- text ---------------------------------------------------------------
    if (text) {
      const t = textScore(poi, text)
      // When the user typed something specific, a place that matches none of it
      // is noise — drop it rather than ranking it low.
      if (t === 0 && !moods.length) continue
      score += WEIGHTS.text * t
    }

    // --- distance -----------------------------------------------------------
    let metres: number | null = null
    if (center) {
      metres = distanceM(center.lat, center.lon, poi.lat, poi.lon)
      score += WEIGHTS.distance * distanceScore(metres)
      why.push(formatDistance(metres))
    }

    // --- open now -----------------------------------------------------------
    // A bonus, never a filter: only ~18% of Mumbai POIs carry opening_hours, so
    // filtering on it would hide most of the city.
    if (poi.tags.opening_hours) {
      const open = isOpenNow(poi.tags.opening_hours, now)
      if (open === 'open') {
        score += WEIGHTS.open
        why.push('open now')
      } else if (open === 'closed') {
        score -= WEIGHTS.open
        why.push('closed now')
      }
      // 'unknown' says nothing either way, so it scores nothing either way.
    }

    // --- community ----------------------------------------------------------
    const community = communityScore(poi)
    if (community !== 0) {
      score += WEIGHTS.community * community
      why.push(community > 0 ? 'reported working' : 'reported broken')
    }

    scored.push({ poi, label: displayName(poi), score, why, distanceM: metres })
  }

  scored.sort((a, b) => b.score - a.score)

  // --- chain de-duplication -------------------------------------------------
  // Five branches of the same chain is a worse answer than five different
  // places, so later repeats of a brand are penalised and the list re-sorted.
  const seenBrand = new Map<string, number>()
  for (const entry of scored) {
    const brand = entry.poi.tags.brand?.toLowerCase() ?? entry.poi.name?.toLowerCase()
    if (!brand) continue
    const seen = seenBrand.get(brand) ?? 0
    if (seen > 0) entry.score -= WEIGHTS.chain * seen
    seenBrand.set(brand, seen + 1)
  }
  scored.sort((a, b) => b.score - a.score)

  /*
   * Near-duplicate suppression.
   *
   * OSM frequently holds the same real place twice under slightly different
   * names and types — "Hiranandani Gardens" as leisure=garden and "Hiranandani
   * Garden" as leisure=park, 20 m apart. Exact-name de-duplication misses these
   * because the names differ by one character, so we drop anything that sits
   * very close to a higher-scoring result with a near-identical name.
   */
  const kept: Ranked[] = []
  for (const entry of scored) {
    const near = kept.find((k) => {
      if (distanceM(k.poi.lat, k.poi.lon, entry.poi.lat, entry.poi.lon) > NEAR_DUPE_M) {
        return false
      }
      const a = norm(k.label)
      const b = norm(entry.label)
      return a === b || a.startsWith(b) || b.startsWith(a)
    })
    if (near) continue
    kept.push(entry)
    if (kept.length >= limit) break
  }

  return kept
}
