import { useCallback, useEffect, useState } from 'react'
import Icon from '../ui/Icon'
import {
  type EventDetail,
  EVENT_CATEGORY_LABELS,
  EVENT_SOURCE_LABELS,
  HangoutError,
  deleteEvent,
  formatPrice,
  formatWhen,
  getEvent,
  joinEvent,
  leaveEvent,
  reportTarget,
} from '../hangout/api'

/**
 * One event: what it is, what it costs, who's going, and the chat for them.
 *
 * "Going" here means going *with this app's people* — it is not a ticket, and
 * the sheet says so. For a paid event the ticket link goes to the actual seller;
 * we never imply we sold you anything.
 */

interface EventSheetProps {
  eventId: string
  signedIn: boolean
  onClose: () => void
  onChanged: () => void
  onOpenRoom: (roomId: string) => void
  onOpenProfile: (userId: string) => void
  onNeedAccount: (purpose: string, then: () => void) => void
  onGo: (place: { id: string; name: string; lat: number; lon: number }) => void
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function EventSheet({
  eventId,
  signedIn,
  onClose,
  onChanged,
  onOpenRoom,
  onOpenProfile,
  onNeedAccount,
  onGo,
}: EventSheetProps) {
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      setEvent(await getEvent(eventId))
      setError(null)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not load this event.')
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  async function join() {
    if (!signedIn) {
      onNeedAccount('say you’re going', () => void join())
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { roomId } = await joinEvent(eventId)
      await load()
      onChanged()
      if (roomId) onOpenRoom(roomId)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    setBusy(true)
    try {
      await leaveEvent(eventId)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not leave.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteEvent(eventId)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not delete.')
      setBusy(false)
    }
  }

  async function submitReport(reason: string) {
    setReporting(false)
    try {
      await reportTarget({ targetType: 'activity', targetId: eventId, reason })
      setNotice('Reported. Thanks — we look at these.')
    } catch {
      setError('Could not send the report.')
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
        className="sheet flex max-h-[88vh] w-full max-w-md animate-sheet-in flex-col rounded-t-sheet bg-surface shadow-high sm:rounded-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-3">
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-muted hover:text-critical-ink"
            aria-label="Report this event"
          >
            <Icon name="flag" size={14} />
          </button>

          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sunken text-3xl">
            {event?.emoji ?? '🎫'}
          </span>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-muted"
            aria-label="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        {reporting && (
          <div className="mx-4 mt-3 rounded-card border border-line bg-sunken p-3">
            <p className="text-xs font-semibold">Report this event</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Spam', 'Not real', 'Wrong details', 'Unsafe'].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => submitReport(reason.toLowerCase())}
                  className="chip chip-idle"
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4">
          <div className="pt-3 text-center">
            <h2 className="text-lg font-semibold leading-snug tracking-[-0.01em]">
              {event?.title ?? '…'}
            </h2>

            {event && (
              <>
                <p className="tabular mt-1.5 text-xs text-muted">
                  {formatWhen(event.startsAt, Date.now(), event.timeKnown)}
                  {event.endsAt && ` – ${timeOf(event.endsAt)}`}
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted">
                  <Icon name="pin" size={12} />
                  <span className="truncate">{event.venueName}</span>
                </p>
                {event.address && (
                  <p className="mt-0.5 text-2xs text-subtle">{event.address}</p>
                )}

                <p
                  className={`mt-3 text-base font-semibold ${
                    event.isFree ? 'text-positive-ink' : ''
                  }`}
                >
                  {formatPrice(event)}
                </p>

                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                  <span className="tag bg-sunken text-muted">
                    {EVENT_CATEGORY_LABELS[event.category]}
                  </span>
                  <span className="tag bg-sunken text-muted">
                    {EVENT_SOURCE_LABELS[event.source]}
                  </span>
                </div>

                {/*
                  Say where this came from and what that does and doesn't
                  guarantee. The three sources are genuinely different in how
                  much you can rely on them.
                */}
                <p className="mt-2 text-2xs leading-relaxed text-subtle">
                  {event.source === 'ticketmaster' &&
                    'Listed by Ticketmaster. Details and price come from them — check the ticket page before travelling.'}
                  {event.source === 'community' &&
                    'Posted by a member of this app. Nobody has verified it — treat it like a message from a stranger, because it is.'}
                  {event.source === 'allevents' &&
                    'Listed on AllEvents, which aggregates ticketed events. Their city listing gives the date but not the start time, so check the listing before you go.'}
                  {event.source === 'luma' &&
                    'Listed publicly on Luma by its organiser. Luma’s city feed does not expose the real price, so we show none rather than guess — open the Luma page for the cost and to RSVP.'}
                  {event.source === 'seed' &&
                    'A regular night this venue is known for, from a hand-compiled list. No ticket and no price, because we do not know either — check with the venue.'}
                </p>

                {event.description && (
                  <p className="notice mt-3 bg-sunken text-left text-muted">
                    {event.description}
                  </p>
                )}

                {event.going > 0 && (
                  <>
                    <p className="mt-4 text-sm font-medium">
                      {event.going} going from here
                    </p>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      {event.attendees.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => onOpenProfile(a.id)}
                          className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-sunken text-sm font-semibold text-muted transition-transform hover:scale-105"
                          title={a.name}
                        >
                          {a.avatarUrl ? (
                            <img
                              src={a.avatarUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            a.name.slice(0, 1).toUpperCase()
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {notice && (
            <p className="notice mt-3 bg-positive-soft text-positive-ink">{notice}</p>
          )}
          {error && (
            <p className="notice mt-3 flex items-start gap-2 bg-critical-soft text-critical-ink">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {confirmingDelete && (
            <div className="notice mt-3 bg-critical-soft text-critical-ink">
              <p className="font-semibold">Delete this event?</p>
              <p className="mt-1 leading-relaxed">
                It disappears for everyone, along with its chat.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={remove}
                  className="btn btn-primary flex-1 py-2 text-xs"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="btn btn-secondary flex-1 py-2 text-xs"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="sheet shrink-0 border-t border-line px-4 pt-2.5">
          {event && (
            <>
              <div className="flex gap-2">
                {event.joined ? (
                  <button
                    type="button"
                    onClick={() => event.roomId && onOpenRoom(event.roomId)}
                    disabled={!event.roomId}
                    className="btn btn-primary flex-1 py-3 disabled:opacity-50"
                  >
                    <Icon name="send" size={15} />
                    Chat
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={join}
                    disabled={busy}
                    className="btn btn-primary flex-1 py-3 disabled:opacity-40"
                  >
                    {busy ? 'Joining…' : "I'm going"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onGo({
                      id: event.id,
                      name: event.venueName,
                      lat: event.lat,
                      lon: event.lon,
                    })
                  }
                  className="btn btn-secondary px-4 py-3"
                  title="Directions to the venue"
                >
                  <Icon name="route" size={15} />
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                {event.ticketUrl && (
                  <a
                    href={event.ticketUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn btn-secondary flex-1 py-2.5 text-xs"
                  >
                    <Icon name="external" size={14} />
                    Get tickets
                  </a>
                )}
                {event.joined && !event.isMine && (
                  <button
                    type="button"
                    onClick={leave}
                    disabled={busy}
                    className="btn btn-ghost flex-1 py-2.5 text-xs"
                  >
                    Not going
                  </button>
                )}
                {event.isMine && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="btn btn-ghost flex-1 py-2.5 text-xs text-critical-ink"
                  >
                    Delete
                  </button>
                )}
              </div>

              <p className="mt-1.5 text-center text-2xs leading-relaxed text-subtle">
                “I'm going” tells other people here, and opens the chat. It is not
                a ticket.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
