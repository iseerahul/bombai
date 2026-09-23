/**
 * The board: places people have been, and places they've put on the map.
 *
 * Two distinct things share this module, and keeping them distinct matters:
 *
 *   Visit — "I was here, on this date, here are my photos."
 *           Belongs to one person. Shows on their board.
 *
 *   Spot  — "This place exists and it's worth going to."
 *           Community-owned. Feeds search and recommendations.
 *
 * A visit can be published as a spot, but that is a separate, deliberate act.
 * The distinction is what lets the recommender use community knowledge without
 * every result being traceable to one person's movements.
 */

import type { Poi } from '../types'

/** Mood keys from src/search/moods.ts, plus ones only people can judge. */
export type SpotTag = string

/**
 * Tags that no OSM field can supply, so they exist only through people.
 *
 * These are exactly the moods `moods.ts` refuses to ship from map data —
 * `NOT_SHIPPABLE` there lists why. A community vote is a real signal where an
 * absent tag was not, so they become available once enough people have voted.
 */
export const COMMUNITY_TAGS: { key: string; label: string }[] = [
  { key: 'chill', label: 'Chill' },
  { key: 'lively', label: 'Lively' },
  { key: 'scenic', label: 'Scenic' },
  { key: 'quiet', label: 'Quiet' },
  { key: 'cheap', label: 'Easy on the wallet' },
  { key: 'good_for_groups', label: 'Good for groups' },
  { key: 'good_for_work', label: 'Good for working' },
  { key: 'late_night', label: 'Open late' },
  { key: 'hidden', label: 'Hidden gem' },
  { key: 'family', label: 'Family friendly' },
]

export interface Photo {
  id: string
  url: string
  width: number
  height: number
  /** Who added it. Null on spots where the uploader chose not to be credited. */
  byId: string | null
  byName: string | null
  createdAt: number
}

export interface Visit {
  id: string
  /** What was visited. Exactly one of these is set. */
  poiId: string | null
  spotId: string | null
  /** Denormalised so a board renders without resolving every reference. */
  label: string
  lat: number
  lon: number
  category: string | null
  visitedAt: number
  note: string | null
  photos: Photo[]
  /** Tags this person applied. Feed the spot's aggregate when published. */
  tags: SpotTag[]
  /** Whether this visit has been published as a community spot. */
  published: boolean
  createdAt: number
}

export interface Spot {
  id: string
  name: string
  lat: number
  lon: number
  category: string
  note: string | null
  /** Tag → how many distinct people applied it. The recommendation signal. */
  tagCounts: Record<string, number>
  photos: Photo[]
  /**
   * How many distinct people have confirmed this exists.
   *
   * A spot with one confirmation is one stranger's claim. The UI must show this
   * number rather than presenting every spot as equally established, and
   * recommendations should weight it.
   */
  confirmations: number
  /** Whether the viewer has confirmed it. */
  confirmedByMe: boolean
  addedById: string | null
  addedByName: string | null
  createdAt: number
  lastConfirmedAt: number | null
  distanceM?: number
}

/** A spot rendered as a Poi so search, ranking and the map can treat it uniformly. */
export function spotToPoi(spot: Spot): Poi {
  return {
    id: `spot:${spot.id}`,
    name: spot.name,
    lat: spot.lat,
    lon: spot.lon,
    category: spot.category,
    subtype: null,
    source: 'community',
    tags: {
      ...(spot.note ? { description: spot.note } : {}),
      confirmations: String(spot.confirmations),
    },
  }
}

export interface BoardSummary {
  visits: number
  photos: number
  spotsAdded: number
  /** Distinct localities touched, for the "12 neighbourhoods" line. */
  areas: number
  firstVisitAt: number | null
}

/** What the create/edit form collects before upload. */
export interface VisitDraft {
  label: string
  lat: number
  lon: number
  poiId: string | null
  spotId: string | null
  category: string | null
  visitedAt: number
  note: string
  tags: SpotTag[]
  /** True when the user also wants this on the public map. */
  publishAsSpot: boolean
}
