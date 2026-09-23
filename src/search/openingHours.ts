/**
 * A deliberately partial `opening_hours` reader.
 *
 * OSM's opening_hours grammar is large; this handles the common shapes and
 * returns 'unknown' for everything else. That bias is intentional: Mumbai's
 * opening_hours coverage is poor, and telling someone a toilet is open when we
 * do not know is a worse failure than admitting we do not know. Callers must
 * treat 'unknown' as "show it, but say hours are unknown".
 *
 * Handles: "24/7", "Mo-Fr 09:00-18:00", "Mo-Su 06:00-22:00", comma-separated
 * rule lists, multiple time ranges, and ranges crossing midnight.
 */

export type OpenState = 'open' | 'closed' | 'unknown'

const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']

function dayIndex(token: string): number {
  return DAYS.indexOf(token.slice(0, 2).toLowerCase())
}

/** Expand "Mo-Fr" / "Mo,We" / "Mo" into day indices. */
function parseDaySpec(spec: string): number[] | null {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const range = trimmed.match(/^([A-Za-z]{2,3})\s*-\s*([A-Za-z]{2,3})$/)
    if (range) {
      const from = dayIndex(range[1])
      const to = dayIndex(range[2])
      if (from < 0 || to < 0) return null
      // Wraps around the week, e.g. Sa-Su.
      for (let i = from; ; i = (i + 1) % 7) {
        out.add(i)
        if (i === to) break
      }
      continue
    }

    const single = dayIndex(trimmed)
    if (single < 0) return null
    out.add(single)
  }
  return out.size ? [...out] : null
}

/** Expand "09:00-18:00" (possibly several, comma-separated) into minute ranges. */
function parseTimeSpec(spec: string): [number, number][] | null {
  const ranges: [number, number][] = []
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const start = Number(m[1]) * 60 + Number(m[2])
    const end = Number(m[3]) * 60 + Number(m[4])
    ranges.push([start, end])
  }
  return ranges.length ? ranges : null
}

export function isOpenNow(
  openingHours: string | undefined,
  now: Date = new Date()
): OpenState {
  if (!openingHours) return 'unknown'

  const value = openingHours.trim()
  if (/^24\/7$/i.test(value)) return 'open'

  // Anything with modifiers we don't model — public holidays, month rules,
  // week numbers, "off", sunrise/sunset — is honestly reported as unknown.
  if (/\b(PH|SH|easter|sunrise|sunset|off|week)\b/i.test(value)) return 'unknown'
  if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(value)) {
    return 'unknown'
  }

  const today = now.getDay()
  const minutes = now.getHours() * 60 + now.getMinutes()

  let sawUsableRule = false

  for (const rule of value.split(';')) {
    const trimmed = rule.trim()
    if (!trimmed) continue

    // "Mo-Fr 09:00-17:00" — split on the first space before a digit.
    const match = trimmed.match(/^([A-Za-z,\s-]+?)\s+(.+)$/)

    let days: number[] | null
    let timeSpec: string

    if (match) {
      days = parseDaySpec(match[1])
      timeSpec = match[2]
    } else {
      // Bare time range with no day spec means every day.
      days = [0, 1, 2, 3, 4, 5, 6]
      timeSpec = trimmed
    }

    if (!days) return 'unknown'

    if (/^24\/7$/i.test(timeSpec)) {
      sawUsableRule = true
      if (days.includes(today)) return 'open'
      continue
    }

    const ranges = parseTimeSpec(timeSpec)
    if (!ranges) return 'unknown'
    sawUsableRule = true

    for (const [start, end] of ranges) {
      if (end >= start) {
        if (days.includes(today) && minutes >= start && minutes < end) return 'open'
      } else {
        // Crosses midnight: open late today, or still open from yesterday.
        const yesterday = (today + 6) % 7
        if (days.includes(today) && minutes >= start) return 'open'
        if (days.includes(yesterday) && minutes < end) return 'open'
      }
    }
  }

  // Every rule parsed cleanly and none matched → genuinely closed right now.
  return sawUsableRule ? 'closed' : 'unknown'
}

/** Short human label for a POI card. */
export function hoursLabel(openingHours: string | undefined): string {
  switch (isOpenNow(openingHours)) {
    case 'open':
      return 'Open now'
    case 'closed':
      return 'Closed now'
    default:
      return 'Hours unknown'
  }
}
