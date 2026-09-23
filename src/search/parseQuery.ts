import type { Interpretation, SearchFilters, StopSpec } from '../types'
import { CATEGORIES, CATEGORY_KEYS } from '../config/categories'
import { matchLocality } from '../config/localities'

/**
 * Turning a question into a search.
 *
 * This is all of it. An earlier design sent the question to an LLM and kept
 * these heuristics only as a fallback for when the quota ran out; the LLM path
 * is gone, and what was the fallback is now the parser. Every function here
 * runs on-device against shipped synonym and locality lists — a civic utility
 * that dies with an API quota isn't a civic utility.
 */

const WORKING_HINTS = ['working', "isn't broken", 'is not broken', 'not broken', 'functional', 'usable']
const WHEELCHAIR_HINTS = ['wheelchair', 'accessible', 'step free', 'step-free', 'ramp', 'disabled']
const FREE_HINTS = ['free', 'no fee', 'without paying', 'no charge']
const OPEN_HINTS = ['open now', 'open right now', 'currently open', 'open at this hour']

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n))
}

export function detectFilters(question: string): SearchFilters {
  const q = question.toLowerCase()
  return {
    working: includesAny(q, WORKING_HINTS) || undefined,
    wheelchair: includesAny(q, WHEELCHAIR_HINTS) || undefined,
    free: includesAny(q, FREE_HINTS) || undefined,
    openNow: includesAny(q, OPEN_HINTS) || undefined,
  }
}

/**
 * Guess categories from the shared synonym lists. Runs on-device with no
 * network call.
 */
export function guessCategories(question: string): string[] {
  const q = ` ${question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `

  const scored: { key: string; score: number }[] = []
  for (const key of CATEGORY_KEYS) {
    let score = 0
    for (const syn of CATEGORIES[key].synonyms) {
      if (q.includes(` ${syn.toLowerCase()} `)) {
        // Longer synonyms are more specific, so weight them higher.
        score = Math.max(score, syn.length)
      }
    }
    if (score > 0) scored.push({ key, score })
  }

  if (/\bflood|waterlog|water log|monsoon|rain|submerg/i.test(question)) {
    scored.push({ key: 'flood_spot', score: 100 })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 2).map((s) => s.key)
}

/** Connectives that signal a multi-stop journey rather than a single search. */
const TRIP_SPLITTERS =
  /\s+(?:but first|before that|before going|before i go|before|then|after that|after which|and then|on the way to|on my way to|en route to)\s+/i

const TRIP_HINTS =
  /\b(but first|before|then|after that|on the way|on my way|i want to go|i need to go|heading to|take the metro|catch the)\b/i

/**
 * Best-effort on-device itinerary parsing.
 *
 * It splits on connectives and guesses a category per fragment. Blunt, but it
 * needs no network call and no quota, so trip planning works offline and can
 * never fail because a third party said no.
 */
export function localTripInterpret(question: string): Interpretation | null {
  if (!TRIP_HINTS.test(question)) return null

  const fragments = question
    .split(TRIP_SPLITTERS)
    .map((f) => f.trim())
    .filter(Boolean)

  if (fragments.length < 2) return null

  // "A but first B" means B happens before A, so reverse into travel order.
  const reversed = /\b(but first|before)\b/i.test(question)
  const ordered = reversed ? [...fragments].reverse() : fragments

  const stops: StopSpec[] = []
  for (const fragment of ordered) {
    const [category] = guessCategories(fragment)
    const locality = matchLocality(fragment)
    if (!category && !locality) continue

    // A fragment naming a specific place reads as "place"; a bare category
    // ("something to eat") stays open for the user to choose.
    const looksNamed = /\b(station|metro|terminus|depot|mall|hospital|market)\b/i.test(
      fragment
    )

    stops.push(
      looksNamed || (locality && !category)
        ? {
            kind: 'place',
            name: fragment.replace(/^(i want to go to|go to|take the metro at|at|to)\s+/i, '').trim(),
            category: category ?? 'transit',
            area: locality?.name,
          }
        : { kind: 'category', category: category ?? 'food', area: locality?.name }
    )
  }

  if (stops.length < 2) return null

  return {
    mode: 'trip',
    stops: [{ kind: 'origin' }, ...stops],
    reply: `Planning a trip with ${stops.length} stops. Worked out on your device — pick a place for any open stop.`,
    local: true,
  }
}
