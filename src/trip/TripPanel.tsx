import type { Poi, RouteResult, TripStop } from '../types'
import { categoryColor } from '../config/categories'
import { formatDistance } from '../search/localIndex'
import { hoursLabel } from '../search/openingHours'
import { formatDuration } from './routing'
import { originNeedsLocation, unresolvedStops } from './plan'
import Icon, { CategoryBadge } from '../ui/Icon'

/**
 * The itinerary panel.
 *
 * Open stops ("somewhere to eat") show suggestions the user picks from; the
 * route is only drawn once every stop has a place. That ordering is deliberate:
 * routing is the only thing here that sends coordinates off the device, so it
 * should happen as a result of an explicit choice, never speculatively.
 *
 * Visually it's a timeline rather than a list — a trip is a sequence, and the
 * connecting rail makes the order legible without numbering every row.
 */

interface TripPanelProps {
  stops: TripStop[]
  route: RouteResult | null
  routing: boolean
  error: string | null
  onChoose: (stopId: string, poi: Poi) => void
  onClearChoice: (stopId: string) => void
  onSelectPoi: (poi: Poi) => void
  onClear: () => void
  /** Start navigating the whole itinerary. */
  onGo?: () => void
  goBusy?: boolean
}

function StopMarker({ stop, index }: { stop: TripStop; index: number }) {
  const isOrigin = stop.spec.kind === 'origin'

  if (isOrigin) {
    return (
      <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-low">
        <Icon name="locate" size={13} />
      </span>
    )
  }

  return (
    <span
      className={`tabular relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold ${
        stop.poi
          ? 'bg-inverse text-inverse-ink shadow-low'
          : 'border border-dashed border-line-strong bg-surface text-subtle'
      }`}
    >
      {index}
    </span>
  )
}

/** Rough walking pace, used to express a detour in minutes as well as metres. */
const WALK_M_PER_S = 1.35

function SuggestionCard({
  poi,
  best,
  onChoose,
  onSelect,
}: {
  poi: Poi
  /** Lowest detour in the list — worth calling out explicitly. */
  best: boolean
  onChoose: () => void
  onSelect: () => void
}) {
  return (
    <li
      className={`flex items-center gap-2 rounded-lg border bg-surface p-1.5 pl-2
                  transition-colors ${
                    best ? 'border-accent/50 bg-accent-soft/40' : 'border-line hover:border-line-strong'
                  }`}
    >
      <CategoryBadge
        category={poi.category}
        color={categoryColor(poi.category)}
        size="sm"
      />
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium">{poi.name}</p>
        {/*
          Detour leads, because it is the number that decides the choice. Plain
          distance is deliberately not shown here: it invites exactly the wrong
          comparison — a nearer place that sends you backwards.
        */}
        <p className="mt-0.5 truncate text-2xs text-muted">
          {poi.detourM != null ? (
            <span className="tabular font-medium text-ink">
              +{formatDistance(poi.detourM)} detour
              {poi.detourM > 0 &&
                ` · ${Math.max(1, Math.round(poi.detourM / WALK_M_PER_S / 60))} min extra walk`}
            </span>
          ) : (
            poi.distanceM != null && (
              <span className="tabular">{formatDistance(poi.distanceM)} away</span>
            )
          )}
        </p>
        <p className="mt-0.5 truncate text-2xs text-subtle">
          {hoursLabel(poi.tags.opening_hours)}
          {poi.tags.cuisine && ` · ${poi.tags.cuisine.replace(/[_;]/g, ' ')}`}
          {best && <span className="ml-1 font-medium text-accent-ink">· Best option</span>}
        </p>
      </button>
      <button
        type="button"
        onClick={onChoose}
        className="btn btn-primary shrink-0 px-3 text-xs"
        style={{ minHeight: '2rem' }}
      >
        Pick
      </button>
    </li>
  )
}

export default function TripPanel({
  stops,
  route,
  routing,
  error,
  onChoose,
  onClearChoice,
  onSelectPoi,
  onClear,
  onGo,
  goBusy,
}: TripPanelProps) {
  // Only stops the user can act on. An origin without a location isn't one of
  // them — it's optional, and listing it read as "pick a place for this".
  const openStops = unresolvedStops(stops)
  const needsLocation = originNeedsLocation(stops)

  return (
    <section className="rounded-card border border-line bg-sunken p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="route" size={15} className="text-accent" />
          Your trip
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="btn btn-ghost px-2 text-xs"
          style={{ minHeight: '1.75rem' }}
        >
          Clear
        </button>
      </div>

      <ol className="mt-3 space-y-3">
        {stops.map((stop, i) => {
          const isOpen = !stop.poi && !stop.fix
          const isLast = i === stops.length - 1

          return (
            <li key={stop.id} className="relative">
              {/* The rail. Dashed while the next stop is still undecided. */}
              {!isLast && (
                <span
                  className={`absolute left-3 top-6 -ml-px h-[calc(100%+0.75rem-1.5rem)] w-0.5 ${
                    stops[i + 1]?.poi ? 'bg-line-strong' : 'bg-line'
                  }`}
                  aria-hidden
                />
              )}

              <div className="flex items-start gap-2.5">
                <StopMarker stop={stop} index={i} />

                <div className="min-w-0 flex-1 pt-0.5">
                  {stop.poi ? (
                    <div className="flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectPoi(stop.poi as Poi)}
                        className="min-w-0 truncate text-left text-sm font-medium hover:text-accent hover:underline"
                      >
                        {stop.poi.name ?? stop.label}
                      </button>
                      {stop.spec.kind === 'category' && (
                        <button
                          type="button"
                          onClick={() => onClearChoice(stop.id)}
                          className="shrink-0 text-2xs font-medium text-subtle underline underline-offset-2 hover:text-ink"
                        >
                          change
                        </button>
                      )}
                    </div>
                  ) : stop.fix ? (
                    <p className="text-sm font-medium">Where you are</p>
                  ) : stop.spec.kind === 'origin' ? (
                    <p className="text-xs leading-relaxed text-muted">
                      Starting from your first stop —{' '}
                      <span className="font-medium text-ink">
                        tap “Near me” to start from where you are instead
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-muted">{stop.label}</p>
                  )}

                  {/* Per-leg walking time, aligned to the leg arriving here. */}
                  {route && i > 0 && route.legs[i - 1] && (
                    <p className="tabular mt-1 flex items-center gap-1 text-2xs text-subtle">
                      <Icon name="clock" size={11} />
                      {formatDistance(route.legs[i - 1].distanceM)} ·{' '}
                      {formatDuration(route.legs[i - 1].durationS)} walk
                    </p>
                  )}

                  {isOpen && stop.options.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {stop.options.slice(0, 6).map((poi, optionIndex) => (
                        <SuggestionCard
                          key={poi.id}
                          poi={poi}
                          best={optionIndex === 0 && poi.detourM != null}
                          onChoose={() => onChoose(stop.id, poi)}
                          onSelect={() => onSelectPoi(poi)}
                        />
                      ))}
                    </ul>
                  )}

                  {isOpen && stop.options.length === 0 && (
                    <p className="notice mt-1.5 bg-surface text-muted">
                      Nothing mapped nearby for this stop. Try naming a place, or
                      pick somewhere on the map and use “Add stop”.
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {openStops.length > 0 && (
        <p className="notice mt-3 flex items-center gap-1.5 bg-surface text-muted">
          <Icon name="info" size={13} className="text-subtle" />
          Pick a place for{' '}
          {openStops.length === 1 ? 'the open stop' : `${openStops.length} open stops`} and
          the route will be drawn.
        </p>
      )}

      {openStops.length === 0 && needsLocation && !route && !routing && (
        <p className="notice mt-3 flex items-center gap-1.5 bg-surface text-muted">
          <Icon name="locate" size={13} className="text-subtle" />
          Routing from your first stop. Tap “Near me” to include where you are.
        </p>
      )}

      {routing && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Icon name="route" size={13} className="animate-pulse-soft text-accent" />
          Finding a walking route…
        </p>
      )}

      {error && (
        <p className="notice mt-3 flex items-start gap-1.5 bg-critical-soft text-critical-ink">
          <Icon name="alert" size={13} className="mt-px" />
          <span className="min-w-0">{error}</span>
        </p>
      )}

      {route && (
        <div className="mt-3 rounded-card border border-line bg-surface px-3 py-2.5">
          <p className="tabular flex items-baseline gap-1.5 text-base font-semibold">
            {formatDistance(route.distanceM)}
            <span className="text-subtle">·</span>
            {formatDuration(route.durationS)}
            <span className="text-xs font-normal text-muted">walking</span>
          </p>
          {route.approximate ? (
            <p className="mt-1 flex items-start gap-1.5 text-2xs leading-snug text-caution-ink">
              <Icon name="alert" size={12} className="mt-px" />
              <span>
                Routing is unavailable, so this is a straight line between stops —
                not a walkable path. Real distance and time will be longer.
              </span>
            </p>
          ) : (
            <p className="mt-1 text-2xs leading-snug text-subtle">
              Walking directions from OpenRouteService. Metro rides aren't
              included — no open timetable data exists for Mumbai Metro.
            </p>
          )}
        </div>
      )}

      {/*
        Go only appears once the route exists — an itinerary with an unchosen
        stop has nothing to navigate, and a dead button is worse than no button.
      */}
      {route && onGo && (
        <button
          type="button"
          onClick={onGo}
          disabled={goBusy}
          className="btn btn-primary mt-2.5 w-full py-3 disabled:opacity-50"
        >
          <Icon name="route" size={16} />
          {goBusy ? 'Starting…' : 'Go'}
        </button>
      )}
    </section>
  )
}
