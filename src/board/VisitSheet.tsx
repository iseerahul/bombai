import { useEffect, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import { COMMUNITY_TAGS, type VisitDraft } from './types'
import { type PreparedPhoto, formatBytes, preparePhotos } from './photos'

/**
 * Log a visit: when, what it was like, and photos.
 *
 * The photo picker is the centre of this sheet, not an afterthought — the
 * photos are the reason anyone comes back to their board. Everything else is
 * optional, and the sheet can be submitted with nothing but a place and a date.
 *
 * Photos are resized on the device before they are ever sent, and if one
 * carries GPS the sheet offers to move the pin there. That offer is explicit
 * rather than automatic: the photo's location and the place you mean are
 * usually the same, but not always, and silently overriding the pin would be
 * surprising.
 */

const MAX_PHOTOS = 6
const NOTE_LIMIT = 500

interface VisitSheetProps {
  /** Pre-filled from the place that was tapped. */
  initial: {
    label: string
    lat: number
    lon: number
    poiId?: string | null
    spotId?: string | null
    category?: string | null
  }
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSave: (draft: VisitDraft, photos: PreparedPhoto[]) => void
}

function todayValue(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function VisitSheet({
  initial,
  busy = false,
  error = null,
  onClose,
  onSave,
}: VisitSheetProps) {
  const [visitedAt, setVisitedAt] = useState(() => todayValue(Date.now()))
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [publish, setPublish] = useState(false)
  const [photos, setPhotos] = useState<PreparedPhoto[]>([])
  const [coords, setCoords] = useState({ lat: initial.lat, lon: initial.lon })
  const [photoCoords, setPhotoCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [working, setWorking] = useState(false)
  const [photoErrors, setPhotoErrors] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  /*
   * Object URLs are a real leak if the sheet is opened and closed repeatedly,
   * so they are revoked on the way out — but only then. Keeping `photos` in the
   * dependency list ran the cleanup on every change, which revoked the URL of a
   * photo still on screen the moment a second one was added. `removePhoto`
   * revokes the one it drops, so a ref read at unmount is the whole job.
   */
  const photosRef = useRef(photos)
  photosRef.current = photos
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl)
    }
  }, [])

  async function addFiles(list: FileList | null) {
    if (!list?.length) return
    setWorking(true)
    setPhotoErrors([])
    try {
      const room = MAX_PHOTOS - photos.length
      const { photos: added, errors } = await preparePhotos(list, room)
      setPhotos((prev) => [...prev, ...added])
      setPhotoErrors(errors)
      // Offer the first GPS we find, if the pin hasn't already been moved there.
      const withGps = added.find((p) => p.coords)
      if (withGps?.coords) setPhotoCoords(withGps.coords)
      // A photo's capture date is a better default than today.
      const dated = added.find((p) => p.takenAt)
      if (dated?.takenAt) setVisitedAt(todayValue(dated.takenAt))
    } finally {
      setWorking(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const next = [...prev]
      const [gone] = next.splice(index, 1)
      if (gone) URL.revokeObjectURL(gone.previewUrl)
      return next
    })
  }

  function toggleTag(key: string) {
    setTags((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || working) return
    const parsed = Date.parse(`${visitedAt}T12:00:00`)
    onSave(
      {
        label: initial.label,
        lat: coords.lat,
        lon: coords.lon,
        poiId: initial.poiId ?? null,
        spotId: initial.spotId ?? null,
        category: initial.category ?? null,
        visitedAt: Number.isFinite(parsed) ? parsed : Date.now(),
        note: note.trim(),
        tags,
        publishAsSpot: publish,
      },
      photos
    )
  }

  const totalBytes = photos.reduce((sum, p) => sum + p.bytes, 0)
  const pinMoved = coords.lat !== initial.lat || coords.lon !== initial.lon

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Log a visit"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-sheet
                   border-t border-line bg-surface shadow-sheet
                   sm:max-w-md sm:rounded-sheet sm:border"
      >
        {/* --- header --- */}
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-4">
          <div className="min-w-0">
            <p className="eyebrow">Been here</p>
            <h2 className="truncate text-lg font-semibold">{initial.label}</h2>
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

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {/* --- photos --- */}
          <p className="eyebrow mt-1">Photos</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div
                key={p.previewUrl}
                className="relative aspect-square overflow-hidden rounded-card border border-line bg-sunken"
              >
                <img
                  src={p.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  width={p.width}
                  height={p.height}
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center
                             rounded-full bg-black/60 text-white"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={working}
                className="flex aspect-square flex-col items-center justify-center gap-1
                           rounded-card border border-dashed border-line-strong bg-sunken
                           text-subtle transition-colors hover:border-accent hover:text-accent
                           disabled:opacity-50"
              >
                <Icon name={working ? 'clock' : 'plus'} size={20} />
                <span className="text-2xs font-medium">{working ? 'Working' : 'Add'}</span>
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />

          {photos.length > 0 && (
            <p className="tabular mt-1.5 text-2xs text-subtle">
              {photos.length} of {MAX_PHOTOS} · {formatBytes(totalBytes)} after resizing
            </p>
          )}

          {photoErrors.map((message) => (
            <p key={message} className="notice mt-1.5 bg-caution-soft text-caution-ink">
              {message}
            </p>
          ))}

          {/* --- GPS offer --- */}
          {photoCoords && !pinMoved && (
            <button
              type="button"
              onClick={() => {
                setCoords(photoCoords)
                setPhotoCoords(null)
              }}
              className="notice mt-2 flex w-full items-start gap-1.5 bg-accent-soft text-left text-accent-ink"
            >
              <Icon name="pin" size={13} className="mt-px shrink-0" />
              <span>
                One of these photos has a location. Move the pin to where it was taken?
              </span>
            </button>
          )}
          {pinMoved && (
            <p className="notice mt-2 flex items-center gap-1.5 bg-positive-soft text-positive-ink">
              <Icon name="check" size={13} />
              Pin moved to the photo's location.
            </p>
          )}

          {/* --- when --- */}
          <p className="eyebrow mt-4">When</p>
          <input
            type="date"
            value={visitedAt}
            max={todayValue(Date.now())}
            onChange={(e) => setVisitedAt(e.target.value)}
            className="field mt-1.5"
          />

          {/* --- what was it like --- */}
          <p className="eyebrow mt-4">What was it like?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {COMMUNITY_TAGS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => toggleTag(t.key)}
                aria-pressed={tags.includes(t.key)}
                className={`chip ${tags.includes(t.key) ? 'chip-active' : 'chip-idle'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* --- note --- */}
          <p className="eyebrow mt-4">Note</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_LIMIT))}
            rows={3}
            placeholder="Anything worth remembering — where to sit, what to order, when to go."
            className="field mt-1.5 resize-none rounded-card py-2.5"
          />
          <p className="tabular mt-1 text-right text-2xs text-subtle">
            {note.length}/{NOTE_LIMIT}
          </p>

          {/* --- publish --- */}
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-card border border-line bg-sunken p-3">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Put this on the public map</span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-muted">
                Your tags and photos help other people find it. Your visit date and
                note stay private either way.
              </span>
            </span>
          </label>

          {error && (
            <p className="notice mt-3 bg-critical-soft text-critical-ink">{error}</p>
          )}
        </div>

        {/* --- actions --- */}
        <div className="divider shrink-0 bg-surface px-4 pt-3">
          <button
            type="submit"
            disabled={busy || working}
            className="btn btn-accent w-full"
            style={{ minHeight: '2.75rem' }}
          >
            {busy ? 'Saving…' : 'Save to my board'}
          </button>
        </div>
      </form>
    </div>
  )
}
