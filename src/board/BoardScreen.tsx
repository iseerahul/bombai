import { useMemo, useState } from 'react'
import Icon from '../ui/Icon'
import { formatDistance } from '../search/localIndex'
import { COMMUNITY_TAGS, type Visit } from './types'

/**
 * My Map — everywhere you've been, as a grid and on the map.
 *
 * This is the part of the product people come back for, so it leads with the
 * photos rather than with a list of place names. An empty map is its own
 * design problem: nobody's first visit is exciting, so the empty state says
 * exactly what to do next rather than congratulating them on starting.
 */

type View = 'grid' | 'list'

interface BoardScreenProps {
  visits: Visit[]
  loading: boolean
  error: string | null
  /** Where the viewer is, for the distance line. Null when unknown. */
  selfLocation: { lat: number; lon: number } | null
  onOpenVisit: (visit: Visit) => void
  onShowOnMap: (visit: Visit) => void
  onAddVisit: () => void
}

function monthKey(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

function tagLabel(key: string): string {
  return COMMUNITY_TAGS.find((t) => t.key === key)?.label ?? key
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex-1">
      <p className="tabular text-xl font-semibold tracking-[-0.02em]">{value}</p>
      <p className="mt-0.5 text-2xs text-subtle">{label}</p>
    </div>
  )
}

export default function BoardScreen({
  visits,
  loading,
  error,
  selfLocation,
  onOpenVisit,
  onShowOnMap,
  onAddVisit,
}: BoardScreenProps) {
  const [view, setView] = useState<View>('grid')

  const sorted = useMemo(
    () => [...visits].sort((a, b) => b.visitedAt - a.visitedAt),
    [visits]
  )

  const stats = useMemo(() => {
    const photos = visits.reduce((n, v) => n + v.photos.length, 0)
    // Distinct ~1.1km cells stands in for "neighbourhoods" without a gazetteer
    // lookup per visit. It is a count of places, not an exact ward tally.
    const cells = new Set(
      visits.map((v) => `${v.lat.toFixed(2)},${v.lon.toFixed(2)}`)
    )
    return { visits: visits.length, photos, areas: cells.size }
  }, [visits])

  /** Grouped by month, so the grid reads as a timeline rather than a dump. */
  const months = useMemo(() => {
    const out: { key: string; visits: Visit[] }[] = []
    for (const v of sorted) {
      const key = monthKey(v.visitedAt)
      const last = out[out.length - 1]
      if (last && last.key === key) last.visits.push(v)
      else out.push({ key, visits: [v] })
    }
    return out
  }, [sorted])

  if (!loading && visits.length === 0 && !error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sunken">
          <Icon name="pin" size={24} className="text-subtle" />
        </span>
        <p className="mt-3 text-base font-semibold">No places yet</p>
        <p className="mt-1.5 max-w-[20rem] text-xs leading-relaxed text-muted">
          Tap any place on the map and choose <strong className="text-ink">Been here</strong> to
          add it, with photos and a note. They build up into your own map of
          Mumbai.
        </p>
        <button type="button" onClick={onAddVisit} className="btn btn-accent mt-4 px-4">
          <Icon name="plus" size={16} />
          Add your first place
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* --- header --- */}
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-[-0.02em]">My Map</h1>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              className={`chip ${view === 'grid' ? 'chip-active' : 'chip-idle'}`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              className={`chip ${view === 'list' ? 'chip-active' : 'chip-idle'}`}
            >
              List
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-3 rounded-card border border-line bg-sunken px-4 py-3">
          <Stat value={stats.visits} label={stats.visits === 1 ? 'place' : 'places'} />
          <Stat value={stats.photos} label={stats.photos === 1 ? 'photo' : 'photos'} />
          <Stat value={stats.areas} label="areas" />
        </div>

        {error && (
          <p className="notice mt-3 bg-critical-soft text-critical-ink">{error}</p>
        )}
      </div>

      {/* --- body --- */}
      <div className="scrollbar-slim mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        {loading && visits.length === 0 && (
          <p className="py-8 text-center text-xs text-subtle">Loading your places…</p>
        )}

        {months.map((month) => (
          <section key={month.key} className="mb-5">
            <p className="eyebrow sticky top-0 z-10 bg-canvas/90 py-1.5 backdrop-blur-sm">
              {month.key}
            </p>

            {view === 'grid' ? (
              <ul className="mt-1.5 grid grid-cols-3 gap-1.5">
                {month.visits.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => onOpenVisit(v)}
                      className="group relative block aspect-square w-full overflow-hidden
                                 rounded-card border border-line bg-sunken"
                    >
                      {v.photos[0] ? (
                        <img
                          src={v.photos[0].url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform
                                     duration-200 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Icon name="pin" size={18} className="text-subtle" />
                        </span>
                      )}

                      {/* Label sits on a gradient so it stays readable on any photo. */}
                      <span
                        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75
                                   to-transparent px-1.5 pb-1.5 pt-5 text-left"
                      >
                        <span className="block truncate text-2xs font-medium text-white">
                          {v.label}
                        </span>
                      </span>

                      {v.photos.length > 1 && (
                        <span
                          className="tabular absolute right-1 top-1 rounded-full bg-black/60
                                     px-1.5 py-0.5 text-2xs font-medium text-white"
                        >
                          {v.photos.length}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {month.visits.map((v) => (
                  <li key={v.id}>
                    <div className="flex items-start gap-3 rounded-card border border-line bg-surface p-3">
                      <button
                        type="button"
                        onClick={() => onOpenVisit(v)}
                        className="h-14 w-14 shrink-0 overflow-hidden rounded-card bg-sunken"
                        aria-label={`Open ${v.label}`}
                      >
                        {v.photos[0] ? (
                          <img
                            src={v.photos[0].url}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center">
                            <Icon name="pin" size={16} className="text-subtle" />
                          </span>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{v.label}</p>
                        <p className="tabular mt-0.5 text-2xs text-subtle">
                          {new Date(v.visitedAt).toLocaleDateString([], {
                            day: 'numeric',
                            month: 'short',
                          })}
                          {selfLocation && (
                            <>
                              {' · '}
                              {formatDistance(
                                Math.hypot(
                                  (v.lat - selfLocation.lat) * 111_000,
                                  (v.lon - selfLocation.lon) * 105_000
                                )
                              )}{' '}
                              away
                            </>
                          )}
                          {v.published && ' · on the public map'}
                        </p>

                        {v.note && (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                            {v.note}
                          </p>
                        )}

                        {v.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {v.tags.slice(0, 3).map((t) => (
                              <span key={t} className="tag bg-sunken text-muted">
                                {tagLabel(t)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onShowOnMap(v)}
                        className="btn btn-ghost shrink-0 !rounded-full p-2"
                        aria-label={`Show ${v.label} on the map`}
                      >
                        <Icon name="pin" size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
