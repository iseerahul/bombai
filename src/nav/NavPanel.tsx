import Icon from '../ui/Icon'
import type { NavState } from './navigation'
import { isTransitPlan } from './transit'
import { arrivalClock, formatDistance, formatEta } from './navigation'

/**
 * The navigation bar.
 *
 * It replaces the chat sheet while you're moving, and shows the three things
 * that matter on foot: how far, how long, and what time you'll get there.
 *
 * What it does NOT show is a turn instruction, because we don't have a reliable
 * one — the free routing tier gives geometry and timings, not a guidance
 * stream. Inventing "turn left in 50 m" from the polyline would be wrong often
 * enough to walk someone into the wrong street, and this app's whole position
 * is that it says what it actually knows.
 */

interface NavPanelProps {
  nav: NavState
  followingMe: boolean
  onToggleFollow: () => void
  onRecenter: () => void
  onStop: () => void
}

export default function NavPanel({
  nav,
  followingMe,
  onToggleFollow,
  onRecenter,
  onStop,
}: NavPanelProps) {
  const nextStop = nav.waypoints[0]
  const transit = isTransitPlan(nav.route) ? nav.route.transit : null

  const modeLabel = {
    walk: 'Walking',
    drive: 'Driving',
    cycle: 'Cycling',
    transit: 'Public transport',
  }[nav.mode]

  return (
    <section
      className="sheet absolute inset-x-0 bottom-0 z-20 rounded-t-sheet border-t border-line
                 bg-surface shadow-sheet sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[420px]
                 sm:rounded-sheet sm:border"
      aria-label="Navigation"
    >
      {nav.arrived ? (
        <div className="px-4 pb-2 pt-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-positive-soft text-positive-ink">
            <Icon name="check" size={22} />
          </span>
          <p className="mt-2 text-base font-semibold">You've arrived</p>
          <p className="mt-0.5 text-xs text-muted">{nav.destination.name}</p>
        </div>
      ) : (
        <div className="px-4 pt-3.5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="tabular text-2xl font-semibold leading-none tracking-[-0.02em]">
                {formatEta(nav.remainingS)}
              </p>
              <p className="tabular mt-1 text-xs text-muted">
                {formatDistance(nav.remainingM)} · arrive{' '}
                {arrivalClock(nav.remainingS)}
              </p>
              <p className="mt-0.5 text-2xs text-subtle">{modeLabel}</p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onRecenter}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-muted"
                aria-label="Recentre"
              >
                <Icon name="locate" size={16} />
              </button>
              <button
                type="button"
                onClick={onToggleFollow}
                aria-pressed={followingMe}
                className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${
                  followingMe ? 'bg-accent text-white' : 'bg-sunken text-muted'
                }`}
              >
                <Icon name="route" size={14} />
                {followingMe ? 'Following' : 'Free look'}
              </button>
            </div>
          </div>

          <p className="mt-2 flex items-center gap-1.5 truncate text-sm">
            <Icon name="pin" size={14} className="shrink-0 text-accent" />
            <span className="truncate font-medium">{nav.destination.name}</span>
          </p>

          {nextStop && (
            <p className="tabular mt-1 flex items-center gap-1.5 truncate text-2xs text-muted">
              <Icon name="clock" size={12} className="shrink-0" />
              via {nextStop.name}
              {nav.waypoints.length > 1 && ` +${nav.waypoints.length - 1} more`}
            </p>
          )}

          {/*
            Transit and "routing is down" both set `approximate`, but they mean
            very different things, so they say different things.
          */}
          {transit ? (
            <div className="notice mt-2 bg-info-soft text-info-ink">
              <p className="font-semibold">
                Walk → {transit.boardName} → {transit.alightName} → walk
              </p>
              <p className="tabular mt-1 leading-relaxed">
                {formatDistance(transit.accessWalkM)} walk ·{' '}
                {formatEta(transit.rideDurationS)} ride ·{' '}
                {formatDistance(transit.egressWalkM)} walk
              </p>
              <p className="mt-1 leading-relaxed opacity-90">
                The ride is estimated from station positions and includes about
                5 minutes of waiting. There is no open timetable for Mumbai, so
                this is not a departure time.
              </p>
            </div>
          ) : (
            nav.route.approximate && (
              <p className="notice mt-2 bg-caution-soft text-caution-ink">
                Routing is unavailable, so this is a straight line — not a real
                path. Distance and time will both be longer in reality.
              </p>
            )
          )}

          {nav.offRoute && !nav.recalculating && (
            <p className="notice mt-2 flex items-center gap-2 bg-caution-soft text-caution-ink">
              <Icon name="alert" size={13} />
              You're off the route.
            </p>
          )}

          {nav.recalculating && (
            <p className="notice mt-2 flex items-center gap-2 bg-sunken text-muted">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
              Recalculating…
            </p>
          )}

          {nav.error && (
            <p className="notice mt-2 bg-critical-soft text-critical-ink">{nav.error}</p>
          )}
        </div>
      )}

      <div className="px-4 pb-1 pt-2.5">
        <button
          type="button"
          onClick={onStop}
          className={`btn w-full py-3 ${nav.arrived ? 'btn-primary' : 'btn-secondary'}`}
        >
          {nav.arrived ? 'Done' : 'Stop navigating'}
        </button>
        {!nav.arrived && (
          <p className="mt-1.5 text-center text-2xs text-subtle">
            Following your location. It stays on this device — only the route
            request used your start point.
          </p>
        )}
      </div>
    </section>
  )
}
