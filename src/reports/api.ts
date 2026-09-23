import type { CommunityReport, Poi, PoiStatus, ReportKind, FloodDepth } from '../types'
import { distanceM } from '../search/localIndex'

/**
 * Community reports client.
 *
 * Reports are the only shared state in the app, and the only reason a
 * server-side database exists. They carry no identity — see worker/schema.sql.
 */

/** A report has to be within this distance of a POI to be considered "about" it. */
const POI_MATCH_RADIUS_M = 60

export async function fetchReports(bbox?: {
  south: number
  west: number
  north: number
  east: number
}): Promise<CommunityReport[]> {
  const query = bbox
    ? `?bbox=${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
    : ''
  const res = await fetch(`/api/reports${query}`)
  if (!res.ok) throw new Error(`Could not load community reports (${res.status}).`)
  const data = (await res.json()) as { reports: CommunityReport[] }
  return data.reports
}

export async function submitReport(input: {
  kind: ReportKind
  lat: number
  lon: number
  poiId?: string | null
  depth?: FloodDepth | null
  note?: string | null
}): Promise<{ id: string; expires_at: number }> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: input.kind,
      lat: input.lat,
      lon: input.lon,
      poi_id: input.poiId ?? null,
      depth: input.depth ?? null,
      note: input.note ?? null,
    }),
  })

  if (res.status === 429) {
    throw new Error("You've sent a lot of reports recently. Try again a bit later.")
  }
  if (!res.ok) throw new Error(`Report failed (${res.status}).`)
  return res.json()
}

export async function voteOnReport(
  reportId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const res = await fetch(`/api/reports/${reportId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  })
  if (!res.ok) throw new Error(`Vote failed (${res.status}).`)
}

/**
 * Decide what the community currently believes about a POI.
 *
 * Weighting: newer reports count for more, and a report's votes adjust its
 * weight. This is deliberately simple — v1 chose a minimal trust model — but
 * it's structured so a real reputation system could replace the weight function
 * without touching anything else.
 */
function reportWeight(report: CommunityReport, now: number): number {
  const ageDays = (now - report.created_at) / (24 * 60 * 60 * 1000)
  // Halve the weight every 7 days.
  const recency = Math.pow(0.5, ageDays / 7)
  // Votes nudge weight but can't drive it to zero or let it run away.
  const votes = Math.max(0.25, Math.min(3, 1 + 0.25 * (report.up - report.down)))
  return recency * votes
}

export function statusForPoi(
  poi: Poi,
  reports: CommunityReport[],
  now = Date.now()
): PoiStatus | undefined {
  const relevant = reports.filter((r) => {
    if (r.kind !== 'working' && r.kind !== 'broken' && r.kind !== 'closed') return false
    if (r.poi_id && r.poi_id === poi.id) return true
    if (r.poi_id) return false
    // Untagged reports still count if they're right on top of the POI.
    return distanceM(poi.lat, poi.lon, r.lat, r.lon) <= POI_MATCH_RADIUS_M
  })

  if (!relevant.length) return undefined

  let working = 0
  let broken = 0
  let lastReportAt = 0

  for (const r of relevant) {
    const w = reportWeight(r, now)
    if (r.kind === 'working') working += w
    else broken += w // 'closed' counts against availability too
    lastReportAt = Math.max(lastReportAt, r.created_at)
  }

  let verdict: PoiStatus['verdict']
  const total = working + broken
  if (total === 0) verdict = 'unknown'
  else if (working / total >= 0.65) verdict = 'working'
  else if (broken / total >= 0.65) verdict = 'broken'
  else verdict = 'contested'

  return { working, broken, lastReportAt, verdict }
}

/** Attach community status to a list of POIs. */
export function mergeStatus(pois: Poi[], reports: CommunityReport[]): Poi[] {
  const now = Date.now()
  // Written unconditionally, including when there is no status: reports expire,
  // and keeping the previous value would leave a tap marked broken long after
  // the report that said so was gone.
  return pois.map((poi) => ({ ...poi, status: statusForPoi(poi, reports, now) }))
}

/** Live flooding reports only — these drive the monsoon layer. */
export function floodReports(reports: CommunityReport[]): CommunityReport[] {
  const now = Date.now()
  return reports.filter(
    (r) => (r.kind === 'flooded' || r.kind === 'clear') && r.expires_at > now
  )
}

export function relativeTime(ts: number, now = Date.now()): string {
  const mins = Math.round((now - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}
