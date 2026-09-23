import type { CommunityReport, Poi } from '../types'
import { categoryColor, categoryLabel } from '../config/categories'
import { formatDistance } from '../search/localIndex'
import { hoursLabel, isOpenNow } from '../search/openingHours'
import { relativeTime } from '../reports/api'
import { useState } from 'react'
import Icon, { CategoryBadge, type IconName } from '../ui/Icon'
import PinGlyph from '../ui/PinGlyph'
import type { TravelMode } from '../trip/routing'

/**
 * Place details, in the spirit of Google Maps' bottom card — but only ever
 * showing what we can actually stand behind.
 *
 * There are no ratings, no review counts and no popularity signals here,
 * because OpenStreetMap has none and inventing them would undermine the one
 * trustworthy signal this app does have: what people reported about the place.
 */

interface DetailPanelProps {
  poi: Poi
  reports: CommunityReport[]
  onClose: () => void
  onReport: (poi: Poi) => void
  /** Start navigating here. The primary action, as on any map app. */
  onGo?: (poi: Poi, mode: TravelMode) => void
  onAddToTrip?: (poi: Poi) => void
  /** Log this place to the viewer's board. */
  onBeenHere?: (poi: Poi) => void
  goBusy?: boolean
}

/** Tags worth surfacing, in display order, with human labels. */
const FACTS: { key: string; label: string; icon: IconName; format?: (v: string) => string }[] = [
  { key: 'opening_hours', label: 'Hours', icon: 'clock' },
  { key: 'phone', label: 'Phone', icon: 'info' },
  { key: 'operator', label: 'Operated by', icon: 'shield' },
  { key: 'cuisine', label: 'Cuisine', icon: 'food', format: (v) => v.replace(/[_;]/g, ' ') },
  {
    key: 'healthcare:speciality',
    label: 'Speciality',
    icon: 'health',
    format: (v) => v.replace(/[_;]/g, ' '),
  },
  { key: 'healthcare', label: 'Type', icon: 'health', format: (v) => v.replace(/_/g, ' ') },
  { key: 'level', label: 'Floor', icon: 'pin' },
  { key: 'description', label: 'Notes', icon: 'info' },
]

function AccessBadges({ poi }: { poi: Poi }) {
  const badges: { text: string; className: string; icon: IconName }[] = []

  const wheelchair = poi.tags.wheelchair
  if (wheelchair === 'yes') {
    badges.push({
      text: 'Step-free access',
      className: 'bg-info-soft text-info-ink',
      icon: 'accessible',
    })
  } else if (wheelchair === 'limited') {
    badges.push({
      text: 'Partly accessible',
      className: 'bg-caution-soft text-caution-ink',
      icon: 'accessible',
    })
  } else if (wheelchair === 'no') {
    badges.push({
      text: 'Not step-free',
      className: 'bg-sunken text-muted',
      icon: 'accessible',
    })
  }

  if (poi.tags.fee === 'yes') {
    badges.push({ text: 'Charges a fee', className: 'bg-sunken text-muted', icon: 'coin' })
  }
  if (poi.tags.fee === 'no') {
    badges.push({ text: 'Free', className: 'bg-positive-soft text-positive-ink', icon: 'check' })
  }
  if (poi.tags.female === 'yes') {
    badges.push({ text: "Women's", className: 'bg-sunken text-muted', icon: 'toilet' })
  }
  if (poi.tags.male === 'yes') {
    badges.push({ text: "Men's", className: 'bg-sunken text-muted', icon: 'toilet' })
  }
  if (poi.tags.drinking_water === 'yes') {
    badges.push({
      text: 'Drinking water',
      className: 'bg-info-soft text-info-ink',
      icon: 'water',
    })
  }

  if (!badges.length) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span key={b.text} className={`tag ${b.className}`}>
          <Icon name={b.icon} size={12} />
          {b.text}
        </span>
      ))}
    </div>
  )
}

function StatusLine({ poi }: { poi: Poi }) {
  const status = poi.status
  if (!status) {
    return (
      <div className="notice flex items-center gap-2 bg-sunken text-muted">
        <Icon name="info" size={14} className="text-subtle" />
        No community reports yet — status unknown.
      </div>
    )
  }

  const view = {
    working: { text: 'Reported working', className: 'bg-positive-soft text-positive-ink', icon: 'check' as const },
    broken: { text: 'Reported broken', className: 'bg-critical-soft text-critical-ink', icon: 'alert' as const },
    contested: { text: 'Reports disagree', className: 'bg-caution-soft text-caution-ink', icon: 'alert' as const },
    unknown: { text: 'Status unclear', className: 'bg-sunken text-muted', icon: 'info' as const },
  }[status.verdict]

  return (
    <div className={`notice flex items-center gap-2 ${view.className}`}>
      <Icon name={view.icon} size={14} />
      <span>
        <strong className="font-semibold">{view.text}</strong>
        <span className="tabular opacity-75"> · last report {relativeTime(status.lastReportAt)}</span>
      </span>
    </div>
  )
}

const MODES: { key: TravelMode; label: string; icon: IconName }[] = [
  { key: 'walk', label: 'Walk', icon: 'accessible' },
  { key: 'drive', label: 'Drive', icon: 'route' },
  { key: 'cycle', label: 'Cycle', icon: 'bench' },
  { key: 'transit', label: 'Transit', icon: 'transit' },
]

export default function DetailPanel({
  poi,
  reports,
  onClose,
  onReport,
  onGo,
  onAddToTrip,
  onBeenHere,
  goBusy,
}: DetailPanelProps) {
  const [mode, setMode] = useState<TravelMode>('walk')
  const open = isOpenNow(poi.tags.opening_hours)

  // Reports filed on this exact POI, newest first.
  const own = reports
    .filter((r) => r.poi_id === poi.id)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5)

  const facts = FACTS.filter((f) => poi.tags[f.key])

  return (
    <div
      /* The floating card in App owns the surface, border and shadow now. */
      className="animate-sheet-in"
    >
      <div className="flex items-start gap-3 p-4 pb-2.5">
        <CategoryBadge
          category={poi.category}
          color={categoryColor(poi.category)}
          size="lg"
        />

        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight tracking-[-0.02em]">
            {poi.name ?? `Unnamed ${categoryLabel(poi.category).toLowerCase()}`}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {categoryLabel(poi.category)}
            {poi.distanceM != null && (
              <span className="tabular"> · {formatDistance(poi.distanceM)} away</span>
            )}
          </p>

          {/* Open/closed is the one thing people check first, so it gets a dot. */}
          <p className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                open === 'open'
                  ? 'bg-positive'
                  : open === 'closed'
                    ? 'bg-critical'
                    : 'bg-line-strong'
              }`}
            />
            <span
              className={
                open === 'open'
                  ? 'font-medium text-positive-ink'
                  : open === 'closed'
                    ? 'font-medium text-critical-ink'
                    : 'text-subtle'
              }
            >
              {hoursLabel(poi.tags.opening_hours)}
            </span>
            {open === 'unknown' && poi.tags.opening_hours == null && (
              <span className="text-subtle">— nobody has mapped hours here</span>
            )}
          </p>

          <AccessBadges poi={poi} />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost -mr-1 -mt-1 aspect-square shrink-0 !rounded-full p-0"
          style={{ width: '2rem', height: '2rem', minHeight: 0 }}
          aria-label="Close details"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="scrollbar-slim max-h-[45vh] overflow-y-auto overscroll-contain px-4 pb-1">
        <StatusLine poi={poi} />

        {facts.length > 0 && (
          <dl className="divider mt-3 space-y-2 pt-3 text-xs">
            {facts.map((f) => (
              <div key={f.key} className="flex gap-2.5">
                <dt className="flex w-24 shrink-0 items-center gap-1.5 text-subtle">
                  <Icon name={f.icon} size={12} />
                  {f.label}
                </dt>
                <dd className="min-w-0 flex-1 text-ink">
                  {f.format ? f.format(poi.tags[f.key]) : poi.tags[f.key]}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {own.length > 0 && (
          <div className="divider mt-3 pt-3">
            <h3 className="eyebrow">Recent reports</h3>
            <ul className="mt-2 space-y-1.5">
              {own.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      r.kind === 'working' || r.kind === 'clear'
                        ? 'bg-positive'
                        : r.kind === 'flooded'
                          ? 'bg-info'
                          : 'bg-critical'
                    }`}
                  />
                  <span className="font-medium capitalize text-ink">{r.kind}</span>
                  <span className="tabular text-subtle">{relativeTime(r.created_at)}</span>
                  {r.up > 0 && <span className="tabular text-positive-ink">+{r.up}</span>}
                  {r.down > 0 && <span className="tabular text-critical-ink">−{r.down}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="divider tabular mt-3 pt-2.5 text-2xs text-subtle">
          {poi.source === 'mcgm'
            ? 'Municipal record (MCGM) via data.opencity.in'
            : 'OpenStreetMap contributors'}
          {' · '}
          {poi.lat.toFixed(4)}, {poi.lon.toFixed(4)}
        </p>
      </div>

      {/*
        How you're travelling changes the route, the time and often the answer
        entirely — a 2-hour walk is a 20-minute drive. Picking it before Go
        rather than after avoids routing twice.
      */}
      {onGo && (
        <div className="divider px-4 pt-2.5">
          <div className="flex gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                aria-pressed={mode === m.key}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-card border py-2
                            text-2xs font-medium transition-colors ${
                              mode === m.key
                                ? 'border-accent bg-accent-soft text-accent-ink'
                                : 'border-line text-muted hover:border-line-strong'
                            }`}
              >
                <Icon name={m.icon} size={16} />
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'transit' && (
            <p className="mt-1.5 text-2xs leading-relaxed text-subtle">
              Estimated from station positions — Mumbai publishes no open
              timetable, so this is not a departure time.
            </p>
          )}
        </div>
      )}

      <div className="sheet flex gap-2 px-4 pt-3">
        {/*
          Go is the primary action now. "Add stop" stays, quieter, because a
          trip in progress still needs a way to grow — but the thing people
          reach for on a place card is directions.
        */}
        {onGo && (
          <button
            type="button"
            onClick={() => onGo(poi, mode)}
            disabled={goBusy}
            className="btn btn-primary flex-1 py-2.5 disabled:opacity-50"
          >
            <Icon name="route" size={15} />
            {goBusy ? 'Starting…' : 'Go'}
          </button>
        )}
        {onAddToTrip && (
          <button
            type="button"
            onClick={() => onAddToTrip(poi)}
            className="btn btn-secondary shrink-0 px-3 py-2.5"
            title="Add as a stop on your trip"
          >
            <Icon name="plus" size={15} />
          </button>
        )}
        {onBeenHere && (
          <button
            type="button"
            onClick={() => onBeenHere(poi)}
            className="btn btn-secondary flex-1 py-2.5"
            title="Add this to My Map, with photos"
          >
            <PinGlyph size={17} />
            Been here
          </button>
        )}
        <button
          type="button"
          onClick={() => onReport(poi)}
          className="btn btn-secondary shrink-0 px-3 py-2.5"
          title="Report a problem with this place"
        >
          <Icon name="flag" size={15} />
        </button>
      </div>
    </div>
  )
}
