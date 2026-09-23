/** A public-utility point, loaded from the baked GeoJSON. */
export interface Poi {
  id: string
  name: string | null
  lat: number
  lon: number
  category: string
  /**
   * The OSM tag that actually matched, e.g. "leisure=park" or "amenity=cinema".
   *
   * Category alone is too coarse to recommend on: a garden and a stadium sit in
   * adjacent leisure categories, but nobody asking for somewhere calm wants a
   * stadium. Null for sources that have no OSM subtype.
   */
  subtype?: string | null
  /** 'community' is a spot a person added, not a mapped or municipal record. */
  source: 'osm' | 'mcgm' | 'manual_seed' | 'community'
  tags: Record<string, string>
  /** Metres from the search centre. Only set on search results. */
  distanceM?: number
  /**
   * Extra walking a trip stop costs versus going straight there, in metres.
   * This — not raw distance — is what ranks stop suggestions: a stall further
   * away but in the right direction beats a closer one that doubles you back.
   */
  detourM?: number
  /** Community status merged in from reports; absent when nobody has reported. */
  status?: PoiStatus
}

export interface PoiStatus {
  working: number
  broken: number
  /** Most recent report timestamp, ms. */
  lastReportAt: number
  /** What the balance of recent reports says. */
  verdict: 'working' | 'broken' | 'contested' | 'unknown'
}

export type ReportKind = 'working' | 'broken' | 'closed' | 'flooded' | 'clear'
export type FloodDepth = 'ankle' | 'knee' | 'waist'

export interface CommunityReport {
  id: string
  poi_id: string | null
  lat: number
  lon: number
  kind: ReportKind
  depth: FloodDepth | null
  note: string | null
  created_at: number
  expires_at: number
  up: number
  down: number
}

/** A coordinate the user has explicitly consented to share, already rounded. */
export interface Fix {
  lat: number
  lon: number
  /** Rounding applied, in metres — surfaced in the UI so the user sees the blurring. */
  precisionM: number
}

export interface SearchFilters {
  /** Exclude anything the community recently reported broken. */
  working?: boolean
  wheelchair?: boolean
  free?: boolean
  openNow?: boolean
}

export interface SearchRequest {
  categories: string[]
  center: { lat: number; lon: number }
  radiusM: number
  filters: SearchFilters
  /** Free-text to match against POI names, e.g. "cheesecake" → bakery names. */
  text?: string
  limit?: number
}

// --- Trip planning ---------------------------------------------------------

export type StopKind = 'origin' | 'category' | 'place'

/** One stop as the interpreter understood it, before any POI is chosen. */
export interface StopSpec {
  kind: StopKind
  category?: string
  name?: string
  area?: string
}

/** A stop once the app has resolved it against local data. */
export interface TripStop {
  id: string
  spec: StopSpec
  /** Human label for the itinerary list. */
  label: string
  /**
   * The chosen place. Null while the user still has to pick one — which is the
   * point of a "category" stop like "somewhere to eat".
   */
  poi: Poi | null
  /** Candidates offered for this stop. Empty for origin stops. */
  options: Poi[]
  /** Origin stops use the user's own position rather than a POI. */
  fix?: Fix
}

export interface RouteResult {
  /** [lon, lat] pairs, ready for a GeoJSON LineString. */
  coordinates: [number, number][]
  distanceM: number
  durationS: number
  legs: { distanceM: number; durationS: number }[]
  profile: string
  /**
   * True when routing was unavailable and this is a straight-line stand-in.
   * The UI must say so — a straight line through Mumbai is not a walk.
   */
  approximate?: boolean
}

/** What the LLM (or the local fallback parser) resolved the question into. */
export type Interpretation =
  | {
      mode: 'search'
      categories: string[]
      area: string | null
      filters: SearchFilters
      text?: string
      reply: string
      /** True when this was resolved entirely on-device with no network call. */
      local: boolean
    }
  | {
      mode: 'recommend'
      categories: string[]
      area: string | null
      picks: { id: string; why: string }[]
      reply: string
      caveat: string
      local: false
    }
  | {
      mode: 'trip'
      stops: StopSpec[]
      reply: string
      local: boolean
    }

export interface ChatTurn {
  id: string
  role: 'user' | 'app'
  text: string
  /** Results attached to an app turn. */
  results?: Poi[]
  interpretation?: Interpretation
  /**
   * Per-result reasons, keyed by POI id: ["park", "310 m", "open now"].
   * Populated by the local ranker; every entry is a fact, not a judgement.
   */
  explanations?: Record<string, string[]>
  error?: string
  pending?: boolean
}
