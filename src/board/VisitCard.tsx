import { useState } from 'react'
import Icon from '../ui/Icon'
import { COMMUNITY_TAGS, type Visit } from './types'

/**
 * One visit, opened.
 *
 * Reachable from two places that used to be dead ends: tapping a green pin on
 * the map, and tapping an entry on the board. Both now land here.
 *
 * Photos lead. The date, the note and the tags are why you kept the place, but
 * the picture is what you recognise it by — so it fills the top of the card and
 * everything else reads underneath it.
 */

interface VisitCardProps {
  visit: Visit
  onClose: () => void
  onShowOnMap: (visit: Visit) => void
  onDelete: (visit: Visit) => void
}

function tagLabel(key: string): string {
  return COMMUNITY_TAGS.find((t) => t.key === key)?.label ?? key
}

export default function VisitCard({
  visit,
  onClose,
  onShowOnMap,
  onDelete,
}: VisitCardProps) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const photos = visit.photos

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={visit.label}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-sheet
                   border-t border-white/40 bg-surface/95 shadow-sheet backdrop-blur-xl
                   dark:border-white/10 sm:max-w-md sm:rounded-sheet sm:border"
      >
        {/* --- photos --- */}
        {photos.length > 0 && (
          <div className="scrollbar-slim flex shrink-0 snap-x snap-mandatory gap-1 overflow-x-auto bg-sunken">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setLightbox(i)}
                className="relative aspect-[4/3] w-full shrink-0 snap-center"
                style={{ maxWidth: photos.length > 1 ? '85%' : '100%' }}
                aria-label={`Photo ${i + 1} of ${photos.length}`}
              >
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                {photos.length > 1 && (
                  <span
                    className="tabular absolute right-2 top-2 rounded-full bg-black/60 px-2
                               py-0.5 text-2xs font-medium text-white"
                  >
                    {i + 1}/{photos.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* --- header --- */}
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-1 pt-3.5">
          <div className="min-w-0">
            <p className="eyebrow">You were here</p>
            <h2 className="truncate text-lg font-semibold">{visit.label}</h2>
            <p className="tabular mt-0.5 text-2xs text-subtle">
              {new Date(visit.visitedAt).toLocaleDateString([], {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost -mr-1 shrink-0 !rounded-full p-2"
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {visit.note && (
            <p className="notice mt-2 whitespace-pre-wrap bg-sunken text-left leading-relaxed text-muted">
              {visit.note}
            </p>
          )}

          {visit.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {visit.tags.map((t) => (
                <span key={t} className="tag bg-accent-soft text-accent-ink">
                  {tagLabel(t)}
                </span>
              ))}
            </div>
          )}

          {photos.length === 0 && !visit.note && visit.tags.length === 0 && (
            <p className="notice mt-2 bg-sunken text-muted">
              No photos or notes on this one — just the place and the date.
            </p>
          )}

          <p className="tabular mt-3 flex items-center gap-1.5 text-2xs text-subtle">
            <Icon name="pin" size={12} />
            {visit.lat.toFixed(5)}, {visit.lon.toFixed(5)}
            {visit.published && ' · also on the public map'}
          </p>
        </div>

        {/* --- actions --- */}
        <div className="divider shrink-0 bg-surface/80 px-4 pt-3">
          {confirmingDelete ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="btn btn-secondary flex-1"
                style={{ minHeight: '2.5rem' }}
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => onDelete(visit)}
                className="btn flex-1 bg-critical text-white"
                style={{ minHeight: '2.5rem' }}
              >
                Delete, with its photos
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onShowOnMap(visit)}
                className="btn btn-accent flex-1"
                style={{ minHeight: '2.5rem' }}
              >
                <Icon name="pin" size={15} />
                Show on map
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="btn btn-secondary shrink-0 px-3"
                style={{ minHeight: '2.5rem' }}
                aria-label="Delete this visit"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* --- full-size photo --- */}
      {lightbox !== null && photos[lightbox] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={(e) => {
            e.stopPropagation()
            setLightbox(null)
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
        >
          <img
            src={photos[lightbox].url}
            alt=""
            className="max-h-full max-w-full rounded-card object-contain"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setLightbox(null)
            }}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center
                       rounded-full bg-white/15 text-white backdrop-blur"
            aria-label="Close photo"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
      )}
    </div>
  )
}
