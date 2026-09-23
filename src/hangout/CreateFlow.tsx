import { useCallback, useEffect, useState } from 'react'
import type { Poi } from '../types'
import Icon, { CategoryBadge } from '../ui/Icon'
import { CATEGORIES, categoryColor, categoryLabel } from '../config/categories'
import { MUMBAI_CENTER, matchLocality, nearestLocality } from '../config/localities'
import { formatDistance, searchWidening } from '../search/localIndex'
import {
  CATEGORY_LABELS,
  type ActivityCategory,
  HangoutError,
  createActivity,
} from './api'

/**
 * Create an activity, in two steps.
 *
 * Step one is the idea — an emoji and "want to ___" — because that is what
 * someone actually has in mind. Step two is the logistics.
 *
 * **On where.** This used to demand a venue from the map dataset. That kept
 * meetings at public places, but the dataset only covers fifteen categories,
 * and most plans genuinely start as "somewhere around here, we'll sort it out
 * in the chat" — so the requirement stopped people posting what they meant.
 *
 * The default is now your current area, and the exact spot gets decided in the
 * chat, which is where it was always being decided anyway. Naming a place from
 * the map stays available for when you already know.
 *
 * The safety property the old rule protected is kept a different way: an
 * approximate activity has its coordinates snapped to a ~250 m grid on the
 * server, so posting one from your sofa publishes a neighbourhood, not an
 * address.
 */

const EMOJI_CHOICES = [
  '🎉', '⚽', '🏀', '🏸', '🏃', '🧘', '🚴',
  '☕', '🍕', '🍦', '🎬', '🎧', '🎸', '🎨',
  '📚', '💻', '🎯', '🏖️', '🥾', '🪩', '🃏', '🐕',
]

const CATEGORY_OPTIONS: ActivityCategory[] = ['sports', 'food', 'study', 'other']

const DURATIONS = [
  { label: '1 hr', ms: 60 * 60 * 1000 },
  { label: '2 hrs', ms: 2 * 60 * 60 * 1000 },
  { label: '3 hrs', ms: 3 * 60 * 60 * 1000 },
]

const VENUE_CATEGORIES = Object.keys(CATEGORIES)

interface CreateFlowProps {
  selfLocation: { lat: number; lon: number } | null
  onClose: () => void
  onCreated: (id: string) => void
}

function defaultStart(): string {
  const d = new Date(Date.now() + 45 * 60 * 1000)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CreateFlow({ selfLocation, onClose, onCreated }: CreateFlowProps) {
  const [step, setStep] = useState<1 | 2>(1)

  const [emoji, setEmoji] = useState('🎉')
  const [pickingEmoji, setPickingEmoji] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<ActivityCategory>('other')

  const [venueQuery, setVenueQuery] = useState('')
  const [venueResults, setVenueResults] = useState<Poi[]>([])
  const [venue, setVenue] = useState<Poi | null>(null)
  const [searching, setSearching] = useState(false)

  const [startLocal, setStartLocal] = useState(defaultStart)
  const [durationMs, setDurationMs] = useState(DURATIONS[1].ms)
  const [capacity, setCapacity] = useState(10)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runVenueSearch = useCallback(
    async (query: string) => {
      const text = query.trim()
      if (text.length < 2) {
        setVenueResults([])
        return
      }
      setSearching(true)
      try {
        // Local search: typing a venue name never leaves the device.
        const locality = matchLocality(text)
        const center = locality ?? selfLocation ?? MUMBAI_CENTER
        const { results } = await searchWidening({
          categories: VENUE_CATEGORIES,
          center: { lat: center.lat, lon: center.lon },
          radiusM: locality?.radiusM ?? (selfLocation ? 3000 : 12000),
          filters: {},
          text: locality ? text.replace(new RegExp(locality.name, 'i'), '').trim() : text,
          limit: 20,
        })
        setVenueResults(results.filter((p) => p.name).slice(0, 12))
      } catch {
        setVenueResults([])
      } finally {
        setSearching(false)
      }
    },
    [selfLocation]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void runVenueSearch(venueQuery), 220)
    return () => window.clearTimeout(timer)
  }, [venueQuery, runVenueSearch])

  const startsAt = new Date(startLocal).getTime()
  const canContinue = title.trim().length >= 3
  /*
   * A place is no longer required — only somewhere to put the bubble. That is
   * either a venue you picked or wherever you are, so the only thing that can
   * block posting now is not knowing where you are at all.
   */
  const where = venue
    ? { id: venue.id, name: venue.name ?? categoryLabel(venue.category), lat: venue.lat, lon: venue.lon }
    : selfLocation
      ? {
          id: null,
          name: `Around ${nearestLocality(selfLocation.lat, selfLocation.lon)?.name ?? 'Mumbai'}`,
          lat: selfLocation.lat,
          lon: selfLocation.lon,
        }
      : null

  const canPost = canContinue && where !== null && Number.isFinite(startsAt) && capacity >= 2

  async function submit() {
    if (!canPost || !where || busy) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await createActivity({
        title: title.trim(),
        category,
        emoji,
        venueId: where.id,
        venueName: where.name,
        lat: where.lat,
        lon: where.lon,
        startsAt,
        endsAt: startsAt + durationMs,
        capacity,
      })
      onCreated(id)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not create the activity.')
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
      <div
        className="sheet flex max-h-[92vh] w-full max-w-md animate-sheet-in flex-col rounded-t-sheet bg-surface shadow-high sm:rounded-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          {step === 2 ? (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn btn-ghost -ml-2 px-2 text-xs"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost -mr-1 aspect-square !rounded-full p-0"
            style={{ width: '2rem', height: '2rem', minHeight: 0 }}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {step === 1 ? (
            <>
              {/* --- the idea --- */}
              <div className="flex flex-col items-center pt-2">
                <button
                  type="button"
                  onClick={() => setPickingEmoji((v) => !v)}
                  className="relative flex h-24 w-24 items-center justify-center rounded-full bg-sunken text-5xl transition-transform active:scale-95"
                >
                  {emoji}
                  <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-surface shadow-low">
                    <Icon name="pin" size={13} className="text-muted" />
                  </span>
                </button>
                <p className="mt-2 text-xs text-subtle">Tap to change emoji</p>
              </div>

              {pickingEmoji && (
                <div className="mt-3 grid grid-cols-7 gap-1.5 rounded-card border border-line bg-sunken p-2">
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        setEmoji(e)
                        setPickingEmoji(false)
                      }}
                      className={`flex h-9 items-center justify-center rounded-lg text-xl transition-colors ${
                        emoji === e ? 'bg-accent-soft' : 'hover:bg-hover'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}

              <p className="eyebrow mt-6">Want to</p>
              <textarea
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                rows={3}
                placeholder="jam together…"
                className="field mt-1.5 w-full resize-none text-base"
              />

              <p className="eyebrow mt-5">Kind</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`chip ${category === c ? 'chip-active' : 'chip-idle'}`}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* --- logistics --- */}
              <p className="eyebrow">Where</p>
              {venue ? (
                <div className="mt-1.5 flex items-center gap-2 rounded-card border border-positive/40 bg-positive-soft p-2">
                  <CategoryBadge
                    category={venue.category}
                    color={categoryColor(venue.category)}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-positive-ink">
                      {venue.name}
                    </p>
                    <p className="text-2xs text-positive-ink/75">
                      {categoryLabel(venue.category)} · verified public venue
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVenue(null)
                      setVenueQuery('')
                    }}
                    className="btn btn-ghost shrink-0 px-2 text-xs"
                    style={{ minHeight: '1.75rem' }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  {/*
                    The default, and the answer most people want: put the bubble
                    where I am, sort the exact spot out in the chat.
                  */}
                  <div className="mt-1.5 flex items-center gap-2.5 rounded-card border border-accent/40 bg-accent-soft p-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                      <Icon name="locate" size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {selfLocation ? (
                        <>
                          <p className="truncate text-sm font-medium text-accent-ink">
                            Around {nearestLocality(selfLocation.lat, selfLocation.lon)?.name ?? 'you'}
                          </p>
                          <p className="text-2xs text-accent-ink/75">
                            Shown as a rough area, not your exact spot. Decide the
                            place in the chat.
                          </p>
                        </>
                      ) : (
                        <p className="text-2xs text-accent-ink">
                          Turn on location to post from where you are, or name a
                          place below.
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="eyebrow mt-4">Or name a place</p>
                  <input
                    value={venueQuery}
                    onChange={(e) => setVenueQuery(e.target.value)}
                    placeholder="Search a park, café, station…"
                    className="field mt-1.5 w-full"
                  />
                  <p className="mt-1 text-2xs text-subtle">
                    Optional. Picking one pins the bubble exactly there.
                  </p>

                  {searching && <p className="mt-2 text-2xs text-subtle">Searching…</p>}

                  <ul className="mt-2 space-y-1.5">
                    {venueResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setVenue(p)}
                          className="flex w-full items-center gap-2 rounded-card border border-line p-2 text-left transition-colors hover:border-line-strong"
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

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="eyebrow" htmlFor="start">
                    Starts
                  </label>
                  <input
                    id="start"
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="field mt-1.5 w-full"
                  />
                </div>
                <div>
                  <p className="eyebrow">For</p>
                  <div className="mt-1.5 flex gap-1.5">
                    {DURATIONS.map((d) => (
                      <button
                        key={d.ms}
                        type="button"
                        onClick={() => setDurationMs(d.ms)}
                        className={`chip flex-1 justify-center ${
                          durationMs === d.ms ? 'chip-active' : 'chip-idle'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="eyebrow" htmlFor="capacity">
                  How many people, including you
                </label>
                <input
                  id="capacity"
                  type="number"
                  min={2}
                  max={50}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  className="field mt-1.5 w-full"
                />
              </div>

              {error && (
                <p className="notice mt-3 flex items-start gap-2 bg-critical-soft text-critical-ink">
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="sheet shrink-0 border-t border-line px-4 pt-2.5">
          {step === 1 ? (
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep(2)}
              className="btn btn-primary w-full py-3 disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={!canPost || busy}
                onClick={submit}
                className="btn btn-primary w-full py-3 disabled:opacity-40"
              >
                {busy ? 'Posting…' : 'Post activity'}
              </button>
              <p className="mt-1.5 text-center text-2xs text-subtle">
                You approve who joins. It disappears a couple of hours after it ends.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
