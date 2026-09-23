import { useMemo, useRef } from 'react'
import Icon from '../ui/Icon'
import { distanceM, formatDistance } from '../search/localIndex'
import {
  type EventCategory,
  type EventSummary,
  formatPrice,
  formatWhen,
} from '../hangout/api'

/**
 * Events, as its own screen over the shared map.
 *
 * Same shape as Hangout — map with floating filters, a list you pull up, and a
 * create button — because they are the same kind of browsing and shouldn't
 * feel like different products.
 *
 * Every card carries its source. The three are not equivalent: a Ticketmaster
 * listing has a real ticket behind it, a member post has a person behind it,
 * and a seeded regular night has neither. Flattening them into one confident
 * list would be the dishonest version of this feature.
 */

/** Ordered by what a Friday-night scroll is actually looking for. */
const CATEGORY_FILTERS: { key: EventCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'music', label: 'Music' },
  { key: 'festival', label: 'Festivals' },
  { key: 'comedy', label: 'Comedy' },
  { key: 'food', label: 'Food' },
  { key: 'outdoors', label: 'Outdoors' },
  { key: 'arts', label: 'Arts' },
  { key: 'wellness', label: 'Wellness' },
  { key: 'sport', label: 'Sport' },
  { key: 'tech', label: 'Tech' },
  { key: 'community', label: 'Meetups' },
]

export type Horizon = 'all' | 'today' | 'week'

/**
 * Narrow a list of events to a time horizon.
 *
 * Lives here next to the buttons that set it, but is applied by the caller so
 * that one filtered list feeds both the strip and the map. It used to be
 * applied inside this component, which meant the map kept showing all 285 pins
 * while the strip showed 14 — and since most people are looking at the map, the
 * buttons read as dead.
 *
 * The bounds matter as much as the filter. "Today" was `startsAt <= end of
 * today` with no lower bound, so it swept in everything already finished; the
 * server keeps recently-past events on purpose, so "Today" was mostly
 * yesterday.
 */
export function withinHorizon<T extends { startsAt: number; endsAt: number | null }>(
  events: T[],
  horizon: Horizon
): T[] {
  if (horizon === 'all') return events

  const now = Date.now()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  if (horizon === 'today') {
    const dayEnd = new Date()
    dayEnd.setHours(23, 59, 59, 999)
    return events.filter(
      (e) =>
        (e.startsAt >= dayStart.getTime() && e.startsAt <= dayEnd.getTime()) ||
        // Something that began last night and is still going is happening
        // today by any reading that matters to someone deciding where to go.
        (e.startsAt < now && (e.endsAt ?? e.startsAt) > now)
    )
  }

  return events.filter(
    (e) => e.startsAt >= dayStart.getTime() && e.startsAt <= now + 7 * 86_400_000
  )
}

interface EventsHomeProps {
  events: EventSummary[]
  loading: boolean
  error: string | null
  category: EventCategory | 'all'
  freeOnly: boolean
  selfLocation: { lat: number; lon: number } | null
  refreshing: boolean
  onCategory: (c: EventCategory | 'all') => void
  onToggleFree: () => void
  /** A chosen day, YYYY-MM-DD, or null. */
  date: string | null
  onDate: (date: string | null) => void
  onOpen: (id: string) => void
  onCreate: () => void
  onRefresh: () => void
  horizon: Horizon
  onHorizon: (h: Horizon) => void
}

function SourceTag({ event }: { event: EventSummary }) {
  const view = {
    community: { text: 'Member post', className: 'bg-accent-soft text-accent-ink' },
    luma: { text: 'Luma', className: 'bg-info-soft text-info-ink' },
    allevents: { text: 'Ticketed', className: 'bg-info-soft text-info-ink' },
    ticketmaster: { text: 'Ticketed', className: 'bg-info-soft text-info-ink' },
    seed: { text: 'Regular night', className: 'bg-sunken text-muted' },
  }[event.source] ?? { text: event.source, className: 'bg-sunken text-muted' }
  return <span className={`tag ${view.className}`}>{view.text}</span>
}

export default function EventsHome({
  events,
  loading,
  error,
  category,
  freeOnly,
  selfLocation,
  refreshing,
  onCategory,
  onToggleFree,
  date,
  onDate,
  onOpen,
  onCreate,
  onRefresh,
  horizon,
  onHorizon,
}: EventsHomeProps) {
  const dateRef = useRef<HTMLInputElement>(null)

  // `events` arrives already narrowed to the horizon, so all that is left is
  // how far away each one is.
  const shown = useMemo(() => {
    if (!selfLocation) return events
    return events.map((e) => ({
      ...e,
      distanceM: distanceM(selfLocation.lat, selfLocation.lon, e.lat, e.lon),
    }))
  }, [events, selfLocation])

  return (
    <>

      {/* --- one floating panel, same shape as the other modes --- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 sm:px-4 sm:pb-5">
        <div
          className="sheet pointer-events-auto w-full max-w-3xl overflow-hidden rounded-sheet
                     border border-white/40 bg-surface/80 shadow-high backdrop-blur-xl
                     dark:border-white/10"
        >
          <div className="px-3 pb-1 pt-3 sm:px-4">
            {/* --- categories --- */}
            <div className="scrollbar-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1.5">
              {CATEGORY_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onCategory(f.key)}
                  className={`chip shrink-0 ${category === f.key ? 'chip-active' : 'chip-idle'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* --- price and horizon --- */}
            <div className="scrollbar-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
              <button
                type="button"
                onClick={onToggleFree}
                aria-pressed={freeOnly}
                className={`chip shrink-0 ${freeOnly ? 'chip-active' : 'chip-idle'}`}
              >
                <Icon name="coin" size={13} />
                Free
              </button>
              {(['all', 'today', 'week'] as Horizon[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    onHorizon(h)
                    // The two are different ways of saying when; picking a
                    // shortcut clears any specific day and vice versa.
                    onDate(null)
                  }}
                  className={`chip shrink-0 ${
                    horizon === h && !date ? 'chip-active' : 'chip-idle'
                  }`}
                >
                  {h === 'all' ? 'Anytime' : h === 'today' ? 'Today' : 'This week'}
                </button>
              ))}

              {/*
                A real date input rather than a custom calendar: every phone
                already has a good native date picker, and yours will be worse.
              */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const el = dateRef.current
                    if (!el) return
                    /*
                     * `showPicker()` is what actually opens the calendar.
                     * Wrapping the input in a <label> only focuses it, which
                     * looks like nothing happening — the bug this replaces.
                     * Browsers without showPicker fall back to a real click on
                     * the input underneath.
                     */
                    if (typeof el.showPicker === 'function') {
                      try {
                        el.showPicker()
                        return
                      } catch {
                        /* blocked in this context — fall through */
                      }
                    }
                    el.click()
                  }}
                  className={`chip w-full ${date ? 'chip-active' : 'chip-idle'}`}
                >
                  <Icon name="clock" size={13} />
                  {date
                    ? new Date(`${date}T12:00:00`).toLocaleDateString([], {
                        day: 'numeric',
                        month: 'short',
                      })
                    : 'Pick a date'}
                </button>

                {/*
                  Transparent and stacked under the button rather than
                  display:none — a hidden input cannot be clicked, and the
                  fallback above needs something real to click.
                */}
                <input
                  ref={dateRef}
                  type="date"
                  value={date ?? ''}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    onDate(e.target.value || null)
                    onHorizon('all')
                  }}
                  aria-label="Show events on a specific date"
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                  tabIndex={-1}
                />
              </div>

              {date && (
                <button
                  type="button"
                  onClick={() => onDate(null)}
                  className="chip chip-idle shrink-0"
                  aria-label="Clear the date"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>

            {error && (
              <p className="notice mb-2 bg-critical-soft text-critical-ink">{error}</p>
            )}
            {loading && shown.length === 0 && (
              <p className="py-4 text-center text-xs text-subtle">Loading events…</p>
            )}
            {!loading && shown.length === 0 && !error && (
              <p className="notice mb-2 bg-sunken text-muted">
                <span className="font-medium text-ink">Nothing for this filter.</span>{' '}
                No free service lists every event in a city, so this board combines
                Luma and AllEvents listings, member posts and a few known regular
                nights. It is genuinely partial, not broken.
              </p>
            )}

            {/* --- the rail --- */}
            {shown.length > 0 && (
              <>
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <p className="tabular text-2xs text-subtle">
                    {shown.length} {shown.length === 1 ? 'event' : 'events'}
                    {freeOnly && ' · free only'}
                  </p>
                  <button
                    type="button"
                    onClick={onRefresh}
                    disabled={refreshing}
                    className="btn btn-ghost px-2 text-2xs disabled:opacity-50"
                    style={{ minHeight: '1.5rem' }}
                  >
                    <Icon name="route" size={12} />
                    {refreshing ? 'Fetching…' : 'Refresh'}
                  </button>
                </div>

                <div className="scrollbar-slim -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
                  {shown.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onOpen(e.id)}
                      className="flex w-[16rem] shrink-0 snap-start flex-col gap-1.5
                                 rounded-card border border-line bg-surface px-3 py-2.5
                                 text-left transition-colors hover:border-line-strong"
                    >
                      <span className="flex items-start gap-2.5">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-lg">
                          {e.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {e.title}
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-muted">
                            {e.venueName}
                          </span>
                          <span className="tabular mt-0.5 block truncate text-2xs text-subtle">
                            {formatWhen(e.startsAt, Date.now(), e.timeKnown)}
                            {e.distanceM != null && ` · ${formatDistance(e.distanceM)}`}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-2xs font-semibold ${
                            e.isFree ? 'text-positive-ink' : 'text-ink'
                          }`}
                        >
                          {formatPrice(e)}
                        </span>
                      </span>

                      <span className="flex flex-wrap items-center gap-1">
                        <SourceTag event={e} />
                        {e.going > 0 && (
                          <span className="tabular tag bg-sunken text-muted">
                            {e.going} going
                          </span>
                        )}
                        {e.joined && (
                          <span className="tag bg-positive-soft text-positive-ink">
                            <Icon name="check" size={10} />
                            Going
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={onCreate}
              className="btn btn-accent mt-2 w-full"
              style={{ minHeight: '2.5rem' }}
            >
              <Icon name="plus" size={16} />
              Post an event
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
