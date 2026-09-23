import { categoryForSubtype } from '../config/categories'
import type { Poi } from '../types'

/**
 * Mood matching, grounded in what Mumbai's OSM data actually contains.
 *
 * Every weight below is attached to a subtype that was measured in the shipped
 * data, not guessed. The counts in each comment are the live figures as of the
 * 2026-09-16 build, and they are the reason some obvious-sounding moods are
 * absent — see NOT_SHIPPABLE at the bottom.
 *
 * A mood is a weighted set of subtypes rather than a category filter because
 * category is too coarse to recommend on: `leisure=garden` and `leisure=stadium`
 * are both "outdoor leisure", but nobody asking for somewhere calm wants a
 * stadium.
 */

export interface Mood {
  key: string
  label: string
  /** Shown under the chip so the user knows what it will actually return. */
  hint: string
  /** Free-text words that select this mood. */
  synonyms: string[]
  /** `subtype` → weight in 0..1. Absent subtype means "not this mood". */
  subtypes: Record<string, number>
  /** OSM `cuisine` values → weight, for the food-centric moods. */
  cuisines?: Record<string, number>
}

export const MOODS: Mood[] = [
  {
    key: 'chill',
    label: 'Chill',
    hint: 'Parks, gardens, seafronts',
    synonyms: [
      'chill', 'relax', 'unwind', 'calm', 'peaceful', 'destress', 'de-stress',
      'sit', 'sit down', 'breathe', 'fresh air', 'lazy', 'slow',
    ],
    // park 1650 · garden 333 · viewpoint 27 · beach 19 · nature_reserve 6
    subtypes: {
      'leisure=park': 1.0,
      'leisure=garden': 1.0,
      'leisure=nature_reserve': 0.9,
      'tourism=viewpoint': 0.9,
      'natural=beach': 0.9,
    },
  },
  {
    key: 'green',
    label: 'Green',
    hint: 'Parks, gardens, nature',
    synonyms: ['green', 'nature', 'trees', 'garden', 'park', 'outdoors', 'picnic', 'grass'],
    subtypes: {
      'leisure=park': 1.0,
      'leisure=garden': 1.0,
      'leisure=nature_reserve': 1.0,
      'leisure=dog_park': 0.6,
    },
  },
  {
    key: 'water',
    label: 'By the water',
    hint: 'Beaches, seafronts, viewpoints',
    synonyms: [
      'beach', 'sea', 'seaface', 'sea face', 'ocean', 'water', 'waterfront',
      'sunset', 'view', 'viewpoint', 'promenade', 'chowpatty', 'shore',
    ],
    // beach 19 · viewpoint 27 · marina 1 — small but high value in Mumbai
    subtypes: {
      'natural=beach': 1.0,
      'tourism=viewpoint': 0.85,
      'leisure=marina': 0.7,
    },
  },
  {
    key: 'lively',
    label: 'Lively',
    hint: 'Markets and malls',
    synonyms: [
      'lively', 'busy', 'buzzing', 'crowd', 'crowded', 'bustling', 'energy',
      'market', 'bazaar', 'shopping', 'mall', 'browse', 'street shopping',
    ],
    // marketplace 95 · mall 80 · department_store 31
    subtypes: {
      'amenity=marketplace': 1.0,
      'shop=mall': 0.9,
      'shop=department_store': 0.6,
    },
  },
  {
    key: 'culture',
    label: 'Culture',
    hint: 'Museums, galleries, theatres',
    synonyms: [
      'culture', 'cultural', 'museum', 'gallery', 'art', 'arts', 'exhibition',
      'theatre', 'theater', 'history', 'heritage', 'show',
    ],
    // artwork 111 · attraction 55 · library 53 · theatre 51 · museum 18 · gallery 13 · arts_centre 8
    subtypes: {
      'tourism=museum': 1.0,
      'tourism=gallery': 1.0,
      'amenity=theatre': 0.95,
      'amenity=arts_centre': 0.9,
      'tourism=attraction': 0.7,
      'tourism=artwork': 0.6,
    },
  },
  {
    key: 'movie',
    label: 'Movie',
    hint: 'Cinemas',
    synonyms: ['movie', 'movies', 'cinema', 'film', 'screening', 'watch a film'],
    // cinema 79
    subtypes: { 'amenity=cinema': 1.0 },
  },
  {
    key: 'active',
    label: 'Active',
    hint: 'Grounds, gyms, courts',
    synonyms: [
      'active', 'sport', 'sports', 'play', 'game', 'gym', 'fitness', 'workout',
      'exercise', 'football', 'cricket', 'turf', 'court', 'ground', 'run',
      'running', 'swim', 'swimming', 'track',
    ],
    // pitch 657 · swimming_pool 447 · fitness_centre 97 · sports_centre 94 · track 25 · stadium 18
    subtypes: {
      'leisure=sports_centre': 1.0,
      'leisure=pitch': 0.9,
      'leisure=fitness_centre': 0.9,
      'leisure=track': 0.85,
      'leisure=swimming_pool': 0.8,
      'leisure=stadium': 0.7,
    },
  },
  {
    key: 'kids',
    label: 'With kids',
    hint: 'Playgrounds and parks',
    synonyms: [
      'kids', 'kid', 'children', 'child', 'family', 'toddler', 'playground',
      'play area', 'with my kids',
    ],
    // playground 352 · theme_park 6 · zoo 2 · park 1650
    subtypes: {
      'leisure=playground': 1.0,
      'tourism=theme_park': 0.95,
      'tourism=zoo': 0.9,
      'leisure=park': 0.7,
    },
  },
  {
    key: 'quiet',
    label: 'Quiet',
    hint: 'Libraries, gardens, museums',
    synonyms: ['quiet', 'silent', 'study', 'read', 'reading', 'peace', 'alone', 'focus', 'library'],
    // library 53 · garden 333 · museum 18 · nature_reserve 6
    subtypes: {
      'amenity=library': 1.0,
      'leisure=garden': 0.8,
      'leisure=nature_reserve': 0.7,
      'tourism=museum': 0.6,
    },
  },
  {
    key: 'coffee',
    label: 'Coffee',
    hint: 'Cafés and tea places',
    synonyms: ['coffee', 'cafe', 'café', 'espresso', 'latte', 'tea', 'chai', 'brew'],
    // cuisine=coffee_shop 161 (measured pre-build); amenity=cafe covers the rest
    subtypes: { 'amenity=cafe': 0.9 },
    cuisines: { coffee_shop: 1.0, tea: 0.7, juice: 0.4 },
  },
  {
    key: 'cheap_eats',
    label: 'Cheap eats',
    hint: 'Quick, street-style food',
    synonyms: [
      'cheap', 'cheap eats', 'budget', 'quick bite', 'snack', 'street food',
      'vada pav', 'fast food', 'affordable',
    ],
    subtypes: { 'amenity=fast_food': 1.0, 'amenity=ice_cream': 0.5 },
    cuisines: { sandwich: 0.8, burger: 0.8, pizza: 0.6, tea: 0.7, juice: 0.7, chicken: 0.6 },
  },
  {
    key: 'meal',
    label: 'Proper meal',
    hint: 'Sit-down restaurants',
    synonyms: ['meal', 'dinner', 'lunch', 'eat', 'hungry', 'restaurant', 'sit down', 'dine'],
    subtypes: { 'amenity=restaurant': 1.0, 'amenity=cafe': 0.4 },
    cuisines: {
      indian: 0.9, south_indian: 0.9, regional: 0.8, chinese: 0.8, italian: 0.8,
      asian: 0.7, seafood: 0.8, mexican: 0.7, kebab: 0.7, pasta: 0.7,
    },
  },
]

/**
 * Moods we deliberately do not offer.
 *
 * Each was considered and rejected because the tag that would support it is
 * present on too little of Mumbai's data to be honest about — measured
 * 2026-09-16 across 2,090 food POIs. Shipping these would mean confidently
 * missing 90%+ of the real answers, which is worse than not offering them.
 *
 * The route to shipping any of them is community tagging: once enough people
 * have voted a place "romantic", that is a real signal from real people rather
 * than an inference from an absent tag.
 */
export const NOT_SHIPPABLE = {
  work_friendly: 'internet_access present on 5.1% of food POIs',
  outdoor: 'outdoor_seating present on 7.9%',
  air_conditioned: 'air_conditioning present on 7.7%',
  romantic: 'no tag models this; needs community votes',
  instagrammable: 'no tag models this; needs community votes',
  hidden_gem: 'no tag models this; needs community votes',
} as const

const BY_KEY = new Map(MOODS.map((m) => [m.key, m]))

export function getMood(key: string): Mood | null {
  return BY_KEY.get(key) ?? null
}

/**
 * Which moods a free-text query is asking for.
 *
 * Longest synonym first, so "sea face" wins over "sea" and a two-word phrase
 * isn't shadowed by one of its own words.
 */
const SYNONYM_INDEX: { phrase: string; mood: string }[] = MOODS.flatMap((m) =>
  m.synonyms.map((phrase) => ({ phrase, mood: m.key }))
).sort((a, b) => b.phrase.length - a.phrase.length)

export function detectMoods(question: string): string[] {
  const haystack = ` ${question.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `
  const found: string[] = []
  for (const { phrase, mood } of SYNONYM_INDEX) {
    if (found.includes(mood)) continue
    if (haystack.includes(` ${phrase} `)) found.push(mood)
  }
  return found
}

/**
 * How well one place matches a mood, in 0..1.
 *
 * Returns 0 — not a small number — when the place's subtype is not in the
 * mood's table at all. A mood is a whitelist, so an unlisted stadium scores
 * nothing for "chill" no matter how close it is.
 */
export function moodScore(poi: Poi, mood: Mood): number {
  let best = 0

  if (poi.subtype && mood.subtypes[poi.subtype] != null) {
    best = mood.subtypes[poi.subtype]
  }

  if (mood.cuisines && poi.tags.cuisine) {
    // OSM packs multiple cuisines as "sandwich;burger".
    for (const raw of poi.tags.cuisine.split(';')) {
      const weight = mood.cuisines[raw.trim().toLowerCase()]
      if (weight != null && weight > best) best = weight
    }
  }

  return best
}

/**
 * Places nobody should be sent to.
 *
 * Mumbai's OSM has 447 `leisure=swimming_pool`, the large majority of which are
 * inside private housing societies. Recommending one would send a stranger to a
 * gate they cannot walk through. `access` is only tagged on some of them, so
 * this is a partial guard, not a complete one — which is why the swimming-pool
 * weight in the `active` mood is below the others rather than at 1.0.
 */
export function isPubliclyReachable(poi: Poi): boolean {
  const access = poi.tags.access?.toLowerCase()
  if (!access) return true
  return !['private', 'no', 'permit', 'customers', 'members'].includes(access)
}

/**
 * Which data files have to be loaded to answer these moods.
 *
 * Derived from each mood's own subtypes rather than hand-listed, so adding a
 * subtype to a mood cannot silently forget to load the file it lives in.
 */
export function categoriesForMoods(moodKeys: string[]): string[] {
  const out = new Set<string>()
  for (const key of moodKeys) {
    const mood = BY_KEY.get(key)
    if (!mood) continue
    for (const subtype of Object.keys(mood.subtypes)) {
      const category = categoryForSubtype(subtype)
      if (category) out.add(category)
    }
    // Cuisine-driven moods live in the food file regardless of subtype.
    if (mood.cuisines) out.add('food')
  }
  return [...out]
}
