import type { Interpretation, Poi, SearchFilters, StopSpec } from '../types'
import { CATEGORIES, CATEGORY_KEYS } from '../config/categories'
import { matchLocality } from '../config/localities'

/**
 * Turning a question into a search.
 *
 * The LLM is the primary parser (that was the design decision). But the whole
 * app must keep working when it isn't available — free tiers run out, networks
 * drop, and a civic utility that dies with its API quota isn't a civic utility.
 * So there's a local heuristic parser underneath that handles the common civic
 * phrasings entirely on-device, and it takes over whenever the server call fails.
 */

/** Words that signal the user wants a judgement, not just a location. */
const RECOMMEND_HINTS = [
  'best',
  'good',
  'better',
  'nice',
  'top',
  'recommend',
  'favourite',
  'favorite',
  'worth',
  'should i',
  'tasty',
  'famous',
]

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
 * network call — also used to pick candidates *before* we call the LLM.
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

export function looksLikeRecommendation(question: string): boolean {
  return includesAny(question.toLowerCase(), RECOMMEND_HINTS)
}

/** Connectives that signal a multi-stop journey rather than a single search. */
const TRIP_SPLITTERS =
  /\s+(?:but first|before that|before going|before i go|before|then|after that|after which|and then|on the way to|on my way to|en route to)\s+/i

const TRIP_HINTS =
  /\b(but first|before|then|after that|on the way|on my way|i want to go|i need to go|heading to|take the metro|catch the)\b/i

/**
 * Best-effort on-device itinerary parsing.
 *
 * Much weaker than the LLM — it splits on connectives and guesses a category
 * per fragment. It exists so trip planning degrades rather than disappearing
 * when the AI is unavailable, which for a free-tier project is a real scenario.
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

/**
 * Pure on-device interpretation. Returns null when it can't tell what's being
 * asked, in which case only the LLM can help.
 */
export function localInterpret(question: string): Interpretation | null {
  const trip = localTripInterpret(question)
  if (trip) return trip

  const categories = guessCategories(question)
  if (!categories.length) return null

  const locality = matchLocality(question)
  const filters = detectFilters(question)

  const labels = categories.map((c) =>
    c === 'flood_spot' ? 'flood-prone spots' : CATEGORIES[c].label.toLowerCase()
  )

  const where = locality ? ` in ${locality.name}` : ' near you'
  const qualifiers: string[] = []
  if (filters.working) qualifiers.push('reported working')
  if (filters.wheelchair) qualifiers.push('step-free')
  if (filters.free) qualifiers.push('free')
  if (filters.openNow) qualifiers.push('open now')

  const qualifierText = qualifiers.length ? ` (${qualifiers.join(', ')})` : ''

  return {
    mode: 'search',
    categories,
    area: locality?.name ?? null,
    filters,
    reply: `Showing ${labels.join(' and ')}${where}${qualifierText}.`,
    local: true,
  }
}

// ---------------------------------------------------------------------------
// Server-assisted interpretation
// ---------------------------------------------------------------------------

/** Trimmed POI shape sent upstream. Deliberately excludes anything user-specific. */
interface Candidate {
  id: string
  name: string
  category: string
  detail?: string
}

/**
 * Build the candidate list the LLM is allowed to choose from.
 *
 * This is the grounding mechanism. The LLM can only recommend places that are
 * already in our dataset, so it can comment on a bakery but cannot invent one
 * that closed in 2019. Note what is NOT in here: no coordinates, no distances,
 * no user location. Only public place names.
 */
export function buildCandidates(pois: Poi[], limit = 40): Candidate[] {
  return pois
    .filter((p) => p.name)
    .slice(0, limit)
    .map((p) => {
      const detail = [p.tags.cuisine, p.tags['healthcare:speciality'], p.tags.healthcare]
        .filter(Boolean)
        .join(', ')
      return {
        id: p.id,
        name: p.name as string,
        category: p.category,
        ...(detail ? { detail } : {}),
      }
    })
}

export class AskUnavailableError extends Error {
  constructor(
    message: string,
    /** Seconds until it's worth retrying, when the server told us. */
    readonly retryAfterS?: number
  ) {
    super(message)
    this.name = 'AskUnavailableError'
  }
}

interface AskResponse {
  mode: 'search' | 'recommend' | 'trip'
  categories?: string[]
  area?: string | null
  filters?: SearchFilters
  text?: string
  picks?: { id: string; why: string }[]
  stops?: StopSpec[]
  reply: string
  caveat?: string
}

/**
 * Ask the Worker to interpret the question.
 * Same-origin relative path — there is no third-party endpoint in the bundle.
 */
export async function askServer(
  question: string,
  candidates: Candidate[],
  signal?: AbortSignal
): Promise<Interpretation> {
  let res: Response
  try {
    res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, candidates }),
      signal,
    })
  } catch {
    throw new AskUnavailableError('Could not reach the interpreter.')
  }

  if (res.status === 429) {
    let scope: string | undefined
    let retryAfterS = Number(res.headers.get('Retry-After')) || 30
    try {
      const body = (await res.json()) as { retryAfterS?: number; scope?: string }
      if (body.retryAfterS) retryAfterS = body.retryAfterS
      scope = body.scope
    } catch {
      /* header value is good enough */
    }

    // Gemini's free tier caps requests PER DAY PER MODEL (20/day here), not per
    // minute. Google's own retry hint is often "1s", which is actively
    // misleading for a daily cap — so for that case we say what's really true.
    throw new AskUnavailableError(
      scope === 'daily'
        ? "Today's free AI allowance is used up (it resets at midnight US Pacific). Searching still works normally — only open-ended phrasing needs the AI."
        : `Too many AI requests just now. Try again in about ${retryAfterS}s.`,
      retryAfterS
    )
  }
  if (!res.ok) {
    throw new AskUnavailableError(`Interpreter returned ${res.status}.`)
  }

  const data = (await res.json()) as AskResponse

  if (data.mode === 'trip') {
    const stops = (data.stops ?? []).filter(
      (s) => s && (s.kind === 'origin' || s.kind === 'place' || s.kind === 'category')
    )
    // A "trip" with fewer than two stops isn't a trip. Fall back to searching
    // rather than showing an itinerary with one entry.
    if (stops.length >= 2) {
      return { mode: 'trip', stops, reply: data.reply, local: false }
    }
  }

  if (data.mode === 'recommend') {
    // Second line of defence. The Worker already drops unknown ids, but the
    // client re-checks against the candidates it actually sent, so a bad or
    // compromised response still cannot introduce a place that isn't ours.
    const allowed = new Set(candidates.map((c) => c.id))
    const picks = (data.picks ?? []).filter((p) => allowed.has(p.id))

    return {
      mode: 'recommend',
      categories: data.categories?.length ? data.categories : guessCategories(question),
      area: data.area ?? null,
      picks,
      reply: data.reply,
      caveat:
        data.caveat ??
        'AI suggestion based on place names only — not verified by community reports.',
      local: false,
    }
  }

  const categories = (data.categories ?? []).filter(
    (c) => c === 'flood_spot' || c in CATEGORIES
  )

  return {
    mode: 'search',
    categories: categories.length ? categories : guessCategories(question),
    area: data.area ?? null,
    filters: data.filters ?? {},
    text: data.text,
    reply: data.reply,
    local: false,
  }
}
