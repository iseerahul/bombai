import { useCallback, useEffect, useRef, useState } from 'react'
import type { Poi } from '../types'
import Icon, { CategoryBadge } from '../ui/Icon'
import { CATEGORIES, categoryColor, categoryLabel } from '../config/categories'
import { MUMBAI_CENTER, matchLocality } from '../config/localities'
import { formatDistance, searchWidening } from '../search/localIndex'
import {
  type EventCategory,
  EVENT_CATEGORY_LABELS,
  HangoutError,
  createEvent,
} from '../hangout/api'

/**
 * Post an event.
 *
 * Coordinates come from a place picked out of the map dataset, so pins land
 * somewhere real; the display name is editable on top of that, because a gig
 * at "Famous Studios" shouldn't be forced to call itself by whatever OSM
 * named the building.
 *
 * Price is explicit — free or an amount. There is no "unknown" option for a
 * member post, because the person posting it does know.
 */

const CATEGORY_OPTIONS: EventCategory[] = [
  'tech',
  'community',
  'music',
  'comedy',
  'arts',
  'sport',
  'food',
  'other',
]

const VENUE_CATEGORIES = Object.keys(CATEGORIES)

interface CreateEventProps {
  selfLocation: { lat: number; lon: number } | null
  onClose: () => void
  onCreated: (id: string, roomId: string) => void
}

function defaultStart(): string {
  const d = new Date(Date.now() + 26 * 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`
}

export default function CreateEvent({
  selfLocation,
  onClose,
  onCreated,
}: CreateEventProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<EventCategory>('music')

  const [venueQuery, setVenueQuery] = useState('')
  const [venueResults, setVenueResults] = useState<Poi[]>([])
  const [place, setPlace] = useState<Poi | null>(null)
  const [venueName, setVenueName] = useState('')
  const [searching, setSearching] = useState(false)

  const [startLocal, setStartLocal] = useState(defaultStart)
  const [durationH, setDurationH] = useState(3)

  const [isFree, setIsFree] = useState(true)
  const [price, setPrice] = useState('')
  const [ticketUrl, setTicketUrl] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The debounce cancels the timer, not a search already running, and the first
   * search pays for loading every category file while a later one is served
   * from cache. So a slow first response could land after a fast second one and
   * replace the right list with the wrong one. Every search takes a number, and
   * only the newest one is allowed to touch state.
   */
  const searchSeq = useRef(0)

  const runSearch = useCallback(
    async (query: string) => {
      const text = query.trim()
      const seq = ++searchSeq.current
      if (text.length < 2) {
        setVenueResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      try {
        const locality = matchLocality(text)
        const center = locality ?? selfLocation ?? MUMBAI_CENTER
        const { results } = await searchWidening({
          categories: VENUE_CATEGORIES,
          center: { lat: center.lat, lon: center.lon },
          radiusM: locality?.radiusM ?? (selfLocation ? 4000 : 14000),
          filters: {},
          text: locality ? text.replace(new RegExp(locality.name, 'i'), '').trim() : text,
          limit: 20,
        })
        if (seq !== searchSeq.current) return
        setVenueResults(results.filter((p) => p.name).slice(0, 12))
      } catch {
        if (seq === searchSeq.current) setVenueResults([])
      } finally {
        // A stale search must not clear the spinner a newer one put up.
        if (seq === searchSeq.current) setSearching(false)
      }
    },
    [selfLocation]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(venueQuery), 220)
    return () => window.clearTimeout(timer)
  }, [venueQuery, runSearch])

  const startsAt = new Date(startLocal).getTime()
  const priceValue = Number(price)
  const valid =
    title.trim().length >= 3 &&
    place !== null &&
    venueName.trim().length > 0 &&
    Number.isFinite(startsAt) &&
    (isFree || (Number.isFinite(priceValue) && priceValue >= 0))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || !place || busy) return
    setBusy(true)
    setError(null)
    try {
      const { id, roomId } = await createEvent({
        title: title.trim(),
        description: description.trim() || null,
        category,
        venueName: venueName.trim(),
        address: place.name && place.name !== venueName.trim() ? place.name : null,
        lat: place.lat,
        lon: place.lon,
        startsAt,
        endsAt: startsAt + durationH * 60 * 60 * 1000,
        isFree,
        priceMin: isFree ? 0 : priceValue,
        priceMax: isFree ? 0 : priceValue,
        ticketUrl: ticketUrl.trim() || null,
      })
      onCreated(id, roomId)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not post the event.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        className="sheet flex max-h-[92vh] w-full max-w-md animate-sheet-in flex-col rounded-t-sheet bg-surface shadow-high sm:rounded-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line p-4 pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Post an event</h2>
            <p className="mt-0.5 text-2xs text-muted">
              It appears with a “member post” label, not as a verified listing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost -mr-1 -mt-1 aspect-square shrink-0 !rounded-full p-0"
            style={{ width: '2rem', height: '2rem', minHeight: 0 }}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <label className="eyebrow" htmlFor="event-title">
              What's happening
            </label>
            <input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="Indie night at the Habitat"
              className="field mt-1.5 w-full"
            />
          </div>

          <div>
            <p className="eyebrow">Kind</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`chip ${category === c ? 'chip-active' : 'chip-idle'}`}
                >
                  {EVENT_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow">Where</p>
            {place ? (
              <>
                <div className="mt-1.5 flex items-center gap-2 rounded-card border border-positive/40 bg-positive-soft p-2">
                  <CategoryBadge
                    category={place.category}
                    color={categoryColor(place.category)}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-positive-ink">
                      {place.name}
                    </p>
                    <p className="text-2xs text-positive-ink/75">
                      {categoryLabel(place.category)} · pin position
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPlace(null)
                      setVenueQuery('')
                    }}
                    className="btn btn-ghost shrink-0 px-2 text-xs"
                    style={{ minHeight: '1.75rem' }}
                  >
                    Change
                  </button>
                </div>

                <label className="eyebrow mt-2 block" htmlFor="venue-name">
                  Venue name to show
                </label>
                <input
                  id="venue-name"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  maxLength={120}
                  className="field mt-1 w-full"
                />
              </>
            ) : (
              <>
                <input
                  value={venueQuery}
                  onChange={(e) => setVenueQuery(e.target.value)}
                  placeholder="Search for the place on the map"
                  className="field mt-1.5 w-full"
                />
                <p className="mt-1 text-2xs text-subtle">
                  Pick a mapped place so the pin lands correctly. You can rename
                  it afterwards.
                </p>
                {searching && <p className="mt-2 text-2xs text-subtle">Searching…</p>}
                <ul className="mt-2 space-y-1.5">
                  {venueResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPlace(p)
                          setVenueName(p.name ?? '')
                        }}
                        className="flex w-full items-center gap-2 rounded-card border border-line p-2 text-left hover:border-line-strong"
                      >
                        <CategoryBadge
                          category={p.category}
                          color={categoryColor(p.category)}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {p.name}
                          </span>
                          <span className="block truncate text-2xs text-muted">
                            {categoryLabel(p.category)}
                            {p.distanceM != null && ` · ${formatDistance(p.distanceM)}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow" htmlFor="event-start">
                Starts
              </label>
              <input
                id="event-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="field mt-1.5 w-full"
              />
            </div>
            <div>
              <label className="eyebrow" htmlFor="event-duration">
                Hours
              </label>
              <input
                id="event-duration"
                type="number"
                min={1}
                max={12}
                value={durationH}
                onChange={(e) => setDurationH(Number(e.target.value))}
                className="field mt-1.5 w-full"
              />
            </div>
          </div>

          <div>
            <p className="eyebrow">Price</p>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => setIsFree(true)}
                className={`chip flex-1 justify-center ${isFree ? 'chip-active' : 'chip-idle'}`}
              >
                Free
              </button>
              <button
                type="button"
                onClick={() => setIsFree(false)}
                className={`chip flex-1 justify-center ${!isFree ? 'chip-active' : 'chip-idle'}`}
              >
                Paid
              </button>
            </div>

            {!isFree && (
              <>
                <input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Ticket price in ₹"
                  className="field mt-2 w-full"
                  aria-label="Ticket price in rupees"
                />
                <input
                  type="url"
                  value={ticketUrl}
                  onChange={(e) => setTicketUrl(e.target.value)}
                  placeholder="Ticket link (https://…)"
                  className="field mt-2 w-full"
                  aria-label="Ticket link"
                />
                <p className="mt-1 text-2xs text-subtle">
                  The link goes to whoever actually sells the ticket. This app
                  takes no payment and handles no money.
                </p>
              </>
            )}
          </div>

          <div>
            <label className="eyebrow" htmlFor="event-desc">
              Details (optional)
            </label>
            <textarea
              id="event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="Line-up, entry rules, what to bring…"
              className="field mt-1.5 w-full resize-none"
            />
          </div>

          {error && (
            <p className="notice flex items-start gap-2 bg-critical-soft text-critical-ink">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="sheet shrink-0 border-t border-line px-4 pt-2.5">
          <button
            type="submit"
            disabled={!valid || busy}
            className="btn btn-primary w-full py-3 disabled:opacity-40"
          >
            {busy ? 'Posting…' : 'Post event'}
          </button>
        </div>
      </form>
    </div>
  )
}
