import type { Poi } from '../types'
import { categoryColor, categoryLabel } from '../config/categories'
import { formatDistance } from '../search/localIndex'
import { hoursLabel } from '../search/openingHours'
import { relativeTime } from '../reports/api'
import Icon, { CategoryBadge } from '../ui/Icon'

interface PoiCardProps {
  poi: Poi
  selected: boolean
  /** Present when this came from an AI recommendation. */
  why?: string
  onSelect: (poi: Poi) => void
  onReport: (poi: Poi) => void
}

/**
 * Community status, as a dot plus a phrase.
 *
 * The dot carries the same colour as the map pin's state, so scanning a list
 * and scanning the map use the same visual rule. Colour is never the only
 * signal — the phrase says the same thing in words.
 */
function StatusLine({ poi }: { poi: Poi }) {
  const status = poi.status

  const view = status
    ? {
        working: { text: 'Reported working', dot: 'bg-positive', tone: 'text-positive-ink' },
        broken: { text: 'Reported broken', dot: 'bg-critical', tone: 'text-critical-ink' },
        contested: { text: 'Reports disagree', dot: 'bg-caution', tone: 'text-caution-ink' },
        unknown: { text: 'Status unclear', dot: 'bg-subtle', tone: 'text-subtle' },
      }[status.verdict]
    : { text: 'No reports yet', dot: 'bg-line-strong', tone: 'text-subtle' }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${view.tone}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${view.dot}`} />
      {view.text}
      {status && (
        <span className="tabular text-subtle">· {relativeTime(status.lastReportAt)}</span>
      )}
    </span>
  )
}

export default function PoiCard({
  poi,
  selected,
  why,
  onSelect,
  onReport,
}: PoiCardProps) {
  const hours = hoursLabel(poi.tags.opening_hours)
  const accessible = poi.tags.wheelchair === 'yes'
  const charges = poi.tags.fee === 'yes'

  return (
    <li>
      <div
        className={`group card overflow-hidden transition-all duration-150 ease-out ${
          selected
            ? 'border-accent shadow-mid ring-1 ring-accent'
            : 'hover:border-line-strong hover:shadow-low'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect(poi)}
          className="flex w-full items-start gap-3 p-3 text-left"
          aria-pressed={selected}
        >
          <CategoryBadge category={poi.category} color={categoryColor(poi.category)} />

          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.01em]">
                {poi.name ?? `Unnamed ${categoryLabel(poi.category).toLowerCase()}`}
              </span>
              {poi.distanceM != null && (
                <span className="tabular shrink-0 text-xs font-medium text-muted">
                  {formatDistance(poi.distanceM)}
                </span>
              )}
            </span>

            <span className="mt-0.5 block truncate text-xs text-muted">
              {categoryLabel(poi.category)}
              {poi.source === 'mcgm' && ' · MCGM record'}
            </span>

            <span className="mt-1.5 block">
              <StatusLine poi={poi} />
            </span>

            {why && (
              <span className="notice mt-2 flex items-start gap-1.5 bg-accent-soft text-accent-ink">
                <Icon name="sparkle" size={13} className="mt-px opacity-70" />
                <span className="min-w-0">{why}</span>
              </span>
            )}

            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              {/*
                Verified means the community has confirmed it working — not
                that the place exists. Everything here exists; only some of it
                has been checked recently. Saying "not verified" rather than
                hiding it is the honest half of the same claim.
              */}
              {poi.status?.verdict === 'working' ? (
                <span className="tag bg-positive-soft text-positive-ink">
                  <Icon name="check" size={11} />
                  Verified
                </span>
              ) : poi.status ? null : (
                // Only shown when nobody has reported at all. When there IS a
                // verdict, StatusLine above already says what it is — repeating
                // it here would be noise.
                <span className="tag bg-caution-soft text-caution-ink">Not verified</span>
              )}
              <span className="tag bg-sunken text-muted">
                <Icon name="clock" size={12} />
                {hours}
              </span>
              {accessible && (
                <span className="tag bg-info-soft text-info-ink">
                  <Icon name="accessible" size={12} />
                  Step-free
                </span>
              )}
              {charges && (
                <span className="tag bg-sunken text-muted">
                  <Icon name="coin" size={12} />
                  Fee
                </span>
              )}
            </span>
          </span>
        </button>

        {/*
         * Secondary actions live in a quieter footer rather than as buttons of
         * equal weight — opening the card is the primary action, and the old
         * layout gave three links the same visual priority.
         */}
        <div className="divider flex items-center gap-1 bg-sunken/60 px-2 py-1">
          <button
            type="button"
            onClick={() => onReport(poi)}
            className="btn btn-ghost px-2 text-xs"
          >
            <Icon name="flag" size={13} />
            Report status
          </button>
          <a
            // Hands off to the user's own map app. We don't do routing, and
            // pretending to would be worse than being clear about the handoff.
            href={`https://www.openstreetmap.org/?mlat=${poi.lat}&mlon=${poi.lon}#map=18/${poi.lat}/${poi.lon}`}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-ghost px-2 text-xs"
          >
            <Icon name="external" size={13} />
            OSM
          </a>
        </div>
      </div>
    </li>
  )
}
