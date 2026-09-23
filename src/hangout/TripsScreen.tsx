import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../ui/Icon'
import {
  type DestinationDetail,
  type TrendingDestination,
  type Trip,
  HangoutError,
  createTrip,
  destinationDetail,
  joinDestination,
  joinTrip,
  searchDestinations,
  destinationImage,
  type DestinationHit,
  leaveTrip,
  deleteTrip,
  listTrending,
  listTrips,
} from './api'

/**
 * Trips — where people are going, and the group chat for each place.
 *
 * Not to be confused with the public map's walking routes. This is
 * "I'll be in Bali in September, who else is going", and the point of saying
 * so is landing in the room with everyone else who said it.
 *
 * Destinations are picked from a list rather than typed freely wherever
 * possible: "Bali", "bali" and "Bali " would otherwise become three separate
 * chats and nobody would meet anyone.
 */

/** Popular destinations, offered as suggestions. Free text still works. */
const SUGGESTED: { name: string; country: string; emoji: string }[] = [
  { name: 'Goa', country: 'India', emoji: '🏖️' },
  { name: 'Bali', country: 'Indonesia', emoji: '🏝️' },
  { name: 'Thailand', country: 'Thailand', emoji: '🛕' },
  { name: 'Jaipur', country: 'India', emoji: '🏰' },
  { name: 'Manali', country: 'India', emoji: '🏔️' },
  { name: 'Ladakh', country: 'India', emoji: '🏔️' },
  { name: 'Kerala', country: 'India', emoji: '🌴' },
  { name: 'Rishikesh', country: 'India', emoji: '🧘' },
  { name: 'Dubai', country: 'UAE', emoji: '🌇' },
  { name: 'Singapore', country: 'Singapore', emoji: '🦁' },
  { name: 'Vietnam', country: 'Vietnam', emoji: '🇻🇳' },
  { name: 'Japan', country: 'Japan', emoji: '🗼' },
  { name: 'Nepal', country: 'Nepal', emoji: '🏔️' },
  { name: 'Udaipur', country: 'India', emoji: '🕌' },
]

function formatRange(startsOn: number, endsOn: number): string {
  const start = new Date(startsOn)
  const end = new Date(endsOn)
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  const startText = start.toLocaleDateString([], { day: 'numeric', month: 'short' })
  const endText = end.toLocaleDateString([], {
    day: 'numeric',
    month: sameMonth ? undefined : 'short',
  })
  return `${startText} – ${endText}`
}

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function PlanForm({
  onDone,
  onCancel,
}: {
  onDone: (roomId: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ name: string; country: string } | null>(null)
  const [from, setFrom] = useState(isoDate(7))
  const [to, setTo] = useState(isoDate(10))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [remote, setRemote] = useState<DestinationHit[]>([])

  /*
   * Anywhere in the world, not a list of fourteen places someone guessed.
   *
   * The curated set still shows on an empty field — it is a better cold start
   * than a blank dropdown — but the moment you type, this searches every city,
   * town, state and country in OpenStreetMap, and forgives the spelling.
   */
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setRemote([])
      return
    }
    let alive = true
    // Debounced, so a fast typist fires one request rather than eight.
    const timer = window.setTimeout(async () => {
      const hits = await searchDestinations(q)
      if (alive) setRemote(hits)
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return SUGGESTED.slice(0, 8).map((d) => ({
        name: d.name,
        country: d.country as string | null,
        kind: null as string | null,
      }))
    }
    const local = SUGGESTED.filter(
      (d) => d.name.toLowerCase().includes(q) || d.country.toLowerCase().includes(q)
    ).map((d) => ({ name: d.name, country: d.country as string | null, kind: null as string | null }))

    // Curated first, then the world, de-duplicated by name.
    const seen = new Set(local.map((d) => d.name.toLowerCase()))
    const extra = remote
      .filter((d) => !seen.has(d.name.toLowerCase()))
      .map((d) => ({ name: d.name, country: d.country, kind: d.kind }))
    return [...local, ...extra].slice(0, 8)
  }, [query, remote])

  const destination = picked?.name ?? query.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (destination.length < 2 || busy) return
    setBusy(true)
    setError(null)
    try {
      const { roomId } = await createTrip({
        destination,
        country: picked?.country ?? null,
        startsOn: new Date(from).getTime(),
        endsOn: new Date(to).getTime(),
        note: note.trim() || null,
      })
      onDone(roomId)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not save the trip.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-sunken p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Plan a trip</p>
        <button type="button" onClick={onCancel} className="btn btn-ghost px-2 text-xs">
          Cancel
        </button>
      </div>

      <p className="eyebrow mt-3">Where to?</p>
      {picked ? (
        <div className="mt-1.5 flex items-center gap-2 rounded-card border border-accent/40 bg-accent-soft p-2">
          <span className="text-lg">
            {SUGGESTED.find((d) => d.name === picked.name)?.emoji ?? '✈️'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-accent-ink">
              {picked.name}
            </span>
            <span className="block text-2xs text-accent-ink/75">{picked.country}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setPicked(null)
              setQuery('')
            }}
            className="btn btn-ghost px-2 text-xs"
            style={{ minHeight: '1.75rem' }}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city or country"
            className="field mt-1.5 w-full"
            aria-label="Destination"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matches.map((d) => (
              <button
                key={`${d.name}|${d.country ?? ''}`}
                type="button"
                onClick={() => setPicked({ name: d.name, country: d.country ?? '' })}
                className="chip chip-idle"
              >
                {d.name}
                {/* The country disambiguates — there is a Goa in India and
                    another in the Philippines, and both come back. */}
                {d.country && (
                  <span className="text-2xs opacity-60">{d.country}</span>
                )}
              </button>
            ))}
          </div>
          {query.trim().length >= 2 && matches.length === 0 && (
            <p className="mt-1.5 text-2xs text-subtle">
              Not on the list — “{query.trim()}” will be used as typed.
            </p>
          )}
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="eyebrow">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="field mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="eyebrow">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="field mt-1 w-full"
          />
        </label>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={280}
        placeholder="What are you up for? (optional)"
        className="field mt-2 w-full resize-none"
      />

      {error && <p className="notice mt-2 bg-critical-soft text-critical-ink">{error}</p>}

      <button
        type="submit"
        disabled={destination.length < 2 || busy}
        className="btn btn-primary mt-3 w-full py-2.5 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Add trip & join the chat'}
      </button>
      <p className="mt-1.5 text-center text-2xs text-subtle">
        You'll be added to the group chat for that destination.
      </p>
    </form>
  )
}

interface TripsScreenProps {
  onMessage: (userId: string) => void
  onOpenRoom: (roomId: string) => void
  /** Told when something changed, so the chat list can refresh. */
  onChanged: () => void
}

/**
 * A photograph of a destination, fetched once per name and remembered.
 *
 * Module-level rather than component state, so ten cards to Goa make one
 * request between them and a re-render never refetches. The server caches
 * again on top of this — neither Commons nor Photon is ours to hammer.
 */
const imageCache = new Map<string, string | null>()

function useDestinationImage(place: string, country?: string | null): string | null {
  const key = `${place}|${country ?? ''}`
  const [url, setUrl] = useState<string | null>(() => imageCache.get(key) ?? null)

  useEffect(() => {
    if (imageCache.has(key)) {
      setUrl(imageCache.get(key) ?? null)
      return
    }
    let alive = true
    void destinationImage(place, country).then((found) => {
      imageCache.set(key, found)
      if (alive) setUrl(found)
    })
    return () => {
      alive = false
    }
  }, [key, place, country])

  return url
}

/**
 * A trending destination.
 *
 * Large and photograph-led: this row is the browse surface, the thing someone
 * scrolls before they know where they want to go. A small text chip cannot do
 * that job — you pick a holiday by looking at it.
 */
function TrendingCard({
  destination: d,
  onOpen,
}: {
  destination: TrendingDestination
  onOpen: () => void
}) {
  const image = useDestinationImage(d.destination, d.country)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex h-56 w-48 shrink-0 flex-col justify-end overflow-hidden
                 rounded-card border border-line bg-sunken text-left shadow-low
                 transition-transform active:scale-[0.98]"
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full animate-fade-in object-cover"
        />
      ) : (
        <span className="absolute right-3 top-3 text-5xl opacity-90">{d.emoji}</span>
      )}

      {/* Dark enough at the foot to carry white text over any photograph. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

      <span className="relative p-3.5">
        <span className="block text-lg font-semibold leading-tight text-white">
          {d.destination}
        </span>
        {d.country && d.country !== d.destination && (
          <span className="mt-0.5 block truncate text-2xs text-white/70">{d.country}</span>
        )}
        <span className="tabular mt-1.5 flex items-center gap-1.5 text-2xs font-medium text-white/90">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {d.travellers} {d.travellers === 1 ? 'person' : 'people'} going
        </span>
      </span>
    </button>
  )
}

/**
 * Who is going, before you commit to going with them.
 *
 * Tapping a trending card used to drop you straight into a group chat with
 * strangers. Browsing and joining are different intentions and a single tap
 * cannot mean both, so this sits between them: the photograph, the faces
 * already in the room, and one button that is unambiguously a decision.
 *
 * The faces matter more than the count. "14 people going" is a statistic;
 * seeing who they are is what makes someone want to be the fifteenth.
 */
function DestinationSheet({
  destination: d,
  onJoin,
  onClose,
}: {
  destination: TrendingDestination
  onJoin: (roomId: string) => void
  onClose: () => void
}) {
  const image = useDestinationImage(d.destination, d.country)
  const [detail, setDetail] = useState<DestinationDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    destinationDetail(d.slug)
      .then((res) => {
        if (alive) setDetail(res)
      })
      .catch(() => {
        // The count on the card is still true even when the faces fail to
        // load, so this degrades to a working join button rather than an error.
        if (alive) {
          setDetail({
            slug: d.slug,
            title: d.destination,
            roomId: d.roomId,
            joined: false,
            members: [],
          })
        }
      })
    return () => {
      alive = false
    }
  }, [d.slug, d.destination, d.roomId])

  const joined = detail?.joined ?? false
  const members = detail?.members ?? []
  const going = detail ? members.length : d.travellers

  async function go() {
    setBusy(true)
    try {
      // Already in? Just open it — joining again is a pointless round trip.
      if (joined && detail?.roomId) {
        onJoin(detail.roomId)
        return
      }
      const { roomId } = await joinDestination(d.destination)
      onJoin(roomId)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not open that chat.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center
                 bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-sheet bg-surface shadow-high sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${d.destination} group`}
      >
        {/* --- where --- */}
        <div className="relative h-40 bg-sunken">
          {image ? (
            <img src={image} alt="" className="h-full w-full animate-fade-in object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-6xl opacity-90">
              {d.emoji}
            </span>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center
                       rounded-full bg-black/45 text-white backdrop-blur-sm"
          >
            <Icon name="close" size={16} />
          </button>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="text-xl font-semibold leading-tight text-white">{d.destination}</p>
            {d.country && d.country !== d.destination && (
              <p className="mt-0.5 text-2xs text-white/70">{d.country}</p>
            )}
          </div>
        </div>

        {/* --- who --- */}
        <div className="p-4">
          {/*
            Counted from the faces, not from the card. The card counts people
            with a trip booked; the room also holds everyone who joined off a
            card without one. Showing "3 going" above seven faces reads like a
            bug, so the list is the number.
          */}
          <p className="eyebrow">
            {going} {going === 1 ? 'person' : 'people'} in this group
          </p>

          {members.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-3">
              {members.slice(0, 12).map((m) => (
                <li key={m.id} className="flex w-12 flex-col items-center gap-1">
                  <span
                    className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full
                               bg-sunken text-sm font-semibold text-muted ring-1 ring-line"
                  >
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      m.name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="w-full truncate text-center text-2xs text-muted">
                    {m.name.split(' ')[0]}
                  </span>
                </li>
              ))}
              {members.length > 12 && (
                <li
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-sunken
                             text-2xs font-semibold text-muted ring-1 ring-line"
                >
                  +{members.length - 12}
                </li>
              )}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {detail === null ? 'Loading…' : 'Nobody in the chat yet — be the first.'}
            </p>
          )}

          {error && <p className="notice mt-3 bg-critical-soft text-critical-ink">{error}</p>}

          <button
            type="button"
            onClick={go}
            disabled={busy}
            className="btn btn-primary mt-4 w-full justify-center py-3 disabled:opacity-60"
          >
            {joined ? 'Open chat' : busy ? 'Joining…' : "I'm in"}
          </button>
          <p className="mt-2 text-center text-2xs text-subtle">
            {joined
              ? "You're already in this group."
              : 'Joining puts you in the group chat for this destination.'}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * One trip.
 *
 * Led by a photograph of where they are going, because that is the thing that
 * makes someone want to come. A row of text saying "Thailand, 12-18 Oct" is
 * information; a picture of Koh Samui is an invitation.
 *
 * The image is decoration, so the card is laid out to work without one — it
 * arrives a moment after the text and simply fades in behind it.
 */
function TripCard({
  trip: t,
  confirming,
  onConfirm,
  onCancelConfirm,
  onOpen,
  onLeave,
  onRemove,
  onMessage,
}: {
  trip: Trip
  confirming: boolean
  onConfirm: () => void
  onCancelConfirm: () => void
  onOpen: () => void
  onLeave: () => void
  onRemove: () => void
  onMessage: () => void
}) {
  return (
    <li className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-start justify-between gap-2 p-3 pb-0">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {t.destination}
            {t.country && t.country !== t.destination && (
              <span className="font-normal text-muted"> · {t.country}</span>
            )}
          </p>
          <p className="tabular mt-0.5 text-2xs text-muted">
            {formatRange(t.startsOn, t.endsOn)} · {t.going} going
          </p>
        </div>
        {t.isMine && <span className="tag shrink-0 bg-accent-soft text-accent-ink">Yours</span>}
      </div>

      <div className="p-3">
        {t.note && <p className="text-xs leading-relaxed text-muted">{t.note}</p>}

        <div
          className={`flex items-center gap-2 ${
            t.note ? 'mt-2.5 border-t border-line pt-2.5' : ''
          }`}
        >
          <button
            type="button"
            onClick={onMessage}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken text-2xs font-semibold text-muted">
              {t.ownerAvatar ? (
                <img
                  src={t.ownerAvatar}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                t.ownerName.slice(0, 1).toUpperCase()
              )}
            </span>
            <span className="min-w-0 truncate text-2xs text-muted">{t.ownerName}</span>
          </button>

          {confirming ? (
            <>
              <button
                type="button"
                onClick={onCancelConfirm}
                className="btn btn-secondary shrink-0 px-3 text-xs"
                style={{ minHeight: '1.9rem' }}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="btn shrink-0 bg-critical px-3 text-xs text-white"
                style={{ minHeight: '1.9rem' }}
              >
                Delete trip
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onOpen}
                className="btn btn-primary shrink-0 px-3 text-xs"
                style={{ minHeight: '1.9rem' }}
              >
                {t.isMine || t.joined ? 'Open chat' : "I'm in"}
              </button>

              {t.isMine ? (
                <button
                  type="button"
                  onClick={onConfirm}
                  className="btn btn-ghost shrink-0 px-2"
                  style={{ minHeight: '1.9rem' }}
                  aria-label="Delete this trip"
                >
                  <Icon name="close" size={14} />
                </button>
              ) : (
                t.joined && (
                  <button
                    type="button"
                    onClick={onLeave}
                    className="btn btn-ghost shrink-0 px-2 text-xs"
                    style={{ minHeight: '1.9rem' }}
                  >
                    Leave
                  </button>
                )
              )}
            </>
          )}
        </div>
      </div>
    </li>
  )
}

export default function TripsScreen({
  onMessage,
  onOpenRoom,
  onChanged,
}: TripsScreenProps) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [trending, setTrending] = useState<TrendingDestination[]>([])
  /** The destination being looked at. Looking is not joining. */
  const [preview, setPreview] = useState<TrendingDestination | null>(null)
  const [planning, setPlanning] = useState(false)
  /** Trip id awaiting a delete confirmation. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [tripRes, trendRes] = await Promise.all([
        listTrips(),
        listTrending().catch(() => ({ trending: [] as TrendingDestination[] })),
      ])
      setTrips(tripRes.trips)
      setTrending(trendRes.trending)
      setError(null)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not load trips.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Called once someone has actually said yes in the preview. */
  function enterDestination(roomId: string) {
    setPreview(null)
    void refresh()
    onChanged()
    onOpenRoom(roomId)
  }

  /**
   * Open a trip's destination chat.
   *
   * Joining is idempotent server-side, so the owner and an existing member can
   * use the same call — it returns the room either way. Previously a trip you
   * owned rendered no button at all, which made your own trip the one thing on
   * this screen you could not open.
   */
  async function openTrip(trip: Trip) {
    try {
      const { roomId } = await joinTrip(trip.id)
      if (roomId) onOpenRoom(roomId)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not open that chat.')
    }
  }

  async function leave(trip: Trip) {
    try {
      await leaveTrip(trip.id)
      await refresh()
      onChanged()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not leave.')
    }
  }

  async function remove(trip: Trip) {
    setConfirming(null)
    try {
      await deleteTrip(trip.id)
      await refresh()
      onChanged()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not delete that trip.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
        <h1 className="text-lg font-semibold tracking-[-0.02em]">Trips</h1>
        {!planning && (
          <button
            type="button"
            onClick={() => setPlanning(true)}
            className="btn btn-primary px-3 text-xs"
            style={{ minHeight: '2rem' }}
          >
            <Icon name="plus" size={14} />
            Plan
          </button>
        )}
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {planning && (
          <PlanForm
            onCancel={() => setPlanning(false)}
            onDone={(roomId) => {
              setPlanning(false)
              void refresh()
              onChanged()
              onOpenRoom(roomId)
            }}
          />
        )}

        {error && <p className="notice mt-3 bg-critical-soft text-critical-ink">{error}</p>}

        {/* --- trending --- */}
        {trending.length > 0 && (
          <>
            <p className="eyebrow mt-4">Trending</p>
            <div className="scrollbar-slim -mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-2">
              {trending.map((d) => (
                <TrendingCard key={d.slug} destination={d} onOpen={() => setPreview(d)} />
              ))}
            </div>
          </>
        )}

        {loading && trips.length === 0 && (
          <p className="py-8 text-center text-xs text-subtle">Loading trips…</p>
        )}

        {!loading && trips.length === 0 && !planning && (
          <div className="py-10 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl">
              ✈️
            </span>
            <p className="mt-3 text-base font-semibold">Where to next?</p>
            <p className="mx-auto mt-1.5 max-w-[16rem] text-xs leading-relaxed text-muted">
              Add a trip and you'll land in the group chat with everyone else
              heading there.
            </p>
            <button
              type="button"
              onClick={() => setPlanning(true)}
              className="btn btn-primary mt-4 px-5 py-2.5"
            >
              <Icon name="plus" size={15} />
              Plan a trip
            </button>
          </div>
        )}

        {/* --- upcoming --- */}
        {trips.length > 0 && (
          <>
            <p className="eyebrow mt-5">Upcoming</p>
            <ul className="mt-2 space-y-2">
              {trips.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  confirming={confirming === t.id}
                  onConfirm={() => setConfirming(t.id)}
                  onCancelConfirm={() => setConfirming(null)}
                  onOpen={() => openTrip(t)}
                  onLeave={() => leave(t)}
                  onRemove={() => remove(t)}
                  onMessage={() => onMessage(t.ownerId)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {preview && (
        <DestinationSheet
          destination={preview}
          onJoin={enterDestination}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
