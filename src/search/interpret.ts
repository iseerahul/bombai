import { CATEGORIES } from '../config/categories'
import { type Locality, matchLocality } from '../config/localities'
import type { SearchFilters } from '../types'
import { MOODS, categoriesForMoods, detectMoods, getMood } from './moods'
import { detectFilters, guessCategories } from './parseQuery'

/**
 * Turning a typed question into a search, entirely on the device.
 *
 * This replaces the round trip to a language model. Everything it needs is
 * already here: a locality gazetteer, a category synonym table, a mood
 * vocabulary and a filter detector. Nothing is sent anywhere, there is no quota
 * to exhaust, and the answer arrives in the same frame the user pressed enter.
 *
 * The trade is flexibility for predictability. A model would handle phrasings
 * this does not know; this always behaves the same way twice and can show the
 * user exactly what it understood, as chips they can correct in one tap. For a
 * utility people use standing on a pavement, that is the better trade.
 */

export interface Interpreted {
  /** Mood keys, in the order they were found. */
  moods: string[]
  /** Category keys whose data files must be loaded. */
  categories: string[]
  area: Locality | null
  filters: SearchFilters
  /** Whatever was left after everything above was recognised. */
  text: string
  /** One plain sentence describing what is being shown. */
  reply: string
  /** True when nothing at all was recognised. */
  empty: boolean
}

/**
 * Words consumed by parsing, removed before the remainder becomes a name
 * search. Without this, "chill place near bandra" would go looking for a place
 * literally called "chill place near bandra".
 */
const FILLER = new Set([
  'a', 'an', 'the', 'near', 'nearby', 'around', 'close', 'to', 'me', 'my',
  'in', 'at', 'on', 'for', 'with', 'by', 'from', 'some', 'somewhere',
  'someplace', 'place', 'places', 'spot', 'spots', 'good', 'best', 'nice',
  'great', 'top', 'find', 'show', 'want', 'need', 'looking', 'look', 'go',
  'get', 'take', 'out', 'watch', 'see', 'visit', 'is', 'are', 'there', 'any',
  'what', 'where', 'can', 'i', 'we', 'you', 'and', 'or', 'of', 'this', 'that',
  'it', 'about', 'like',
  // Consumed by detectFilters, so they must not survive into a name search.
  'open', 'now', 'today', 'tonight', 'free', 'wheelchair', 'accessible',
  'step', 'stepfree', 'working',
])

function leftoverText(
  question: string,
  moods: string[],
  categories: string[],
  area: Locality | null
): string {
  let rest = ` ${question.toLowerCase()} `

  const strip = (phrase: string) => {
    const p = phrase.toLowerCase().trim()
    if (!p) return
    rest = rest.split(` ${p} `).join(' ')
  }

  for (const key of moods) {
    const mood = getMood(key)
    // Longest first, so "sea face" is removed before "sea" can split it.
    for (const s of [...(mood?.synonyms ?? [])].sort((a, b) => b.length - a.length)) {
      strip(s)
    }
  }
  for (const key of categories) {
    for (const s of [...(CATEGORIES[key]?.synonyms ?? [])].sort((a, b) => b.length - a.length)) {
      strip(s)
    }
  }
  if (area) {
    strip(area.name)
    for (const alias of area.aliases) strip(alias)
  }

  return rest
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(' ')
    .trim()
}

/** A list read the way a person would say it: "a, b and c". */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function describe(
  moods: string[],
  categories: string[],
  area: Locality | null,
  text: string,
  filters: SearchFilters
): string {
  const moodLabels = moods
    .map((k) => getMood(k)?.label.toLowerCase())
    .filter((l): l is string => !!l)

  let what: string
  if (moodLabels.length) {
    what = `${joinWords(moodLabels)} spots`
  } else if (categories.length) {
    what = joinWords(categories.map((k) => CATEGORIES[k]?.short.toLowerCase() ?? k))
  } else {
    what = 'places'
  }

  if (text) what = `${what} matching “${text}”`

  const where = area ? ` in ${area.name}` : ' near you'
  const when = filters.openNow ? ', open now' : ''
  const extra = filters.wheelchair ? ', step-free' : ''

  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${where}${when}${extra}.`
}

/** Remove every phrase a mood already claimed, longest first. */
function withoutMoodWords(question: string, moods: string[]): string {
  let rest = ` ${question.toLowerCase()} `
  for (const key of moods) {
    const mood = getMood(key)
    for (const phrase of [...(mood?.synonyms ?? [])].sort((a, b) => b.length - a.length)) {
      rest = rest.split(` ${phrase} `).join(' ')
    }
  }
  return rest
}

export function interpret(question: string): Interpreted {
  const moods = detectMoods(question)
  const area = matchLocality(question)
  const filters = detectFilters(question)

  /*
   * Categories are guessed from what the moods did NOT already claim.
   *
   * Without this, "somewhere by the water" loads drinking fountains: "water"
   * is both a `water` mood synonym and a `drinking_water` category synonym, and
   * whoever asked for the seaside did not mean a tap. The mood is the more
   * specific reading, so it wins and the word is consumed before the category
   * matcher ever sees it.
   */
  const fromCategories = guessCategories(withoutMoodWords(question, moods))
  const fromMoods = categoriesForMoods(moods)
  const categories = [...new Set([...fromMoods, ...fromCategories])]

  const text = leftoverText(question, moods, fromCategories, area)

  return {
    moods,
    categories,
    area,
    filters,
    text,
    reply: describe(moods, fromCategories, area, text, filters),
    empty: moods.length === 0 && categories.length === 0 && text.length === 0,
  }
}

/**
 * The starter chips, and what each one is for.
 *
 * Kept to moods with real depth behind them — every one of these returns
 * hundreds of places rather than a handful, so a first tap never lands on an
 * empty list.
 */
export const QUICK_MOODS = ['chill', 'coffee', 'water', 'kids', 'culture', 'active'] as const

export function moodLabel(key: string): string {
  return MOODS.find((m) => m.key === key)?.label ?? key
}

export function moodHint(key: string): string {
  return MOODS.find((m) => m.key === key)?.hint ?? ''
}
