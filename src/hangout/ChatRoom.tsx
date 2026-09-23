import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import {
  type RoomDetail,
  type RoomMessage,
  HangoutError,
  fetchRoomMessages,
  getRoom,
  joinRoom,
  leaveRoom,
  reportTarget,
  sendRoomMessage,
} from './api'

/**
 * A chat room, full screen.
 *
 * Group conversation used to be squeezed into the activity sheet, under the
 * details, which meant it was never more than a few lines tall and scrolled
 * against the sheet. A conversation deserves the whole screen: header, history,
 * composer — the shape every messaging app uses because it works.
 *
 * Rooms are the same component whether they belong to an activity or to a
 * destination ("everyone going to Bali"), because they behave identically.
 */

const POLL_MS = 4000

interface ChatRoomProps {
  roomId: string
  onBack: () => void
  onOpenProfile?: (userId: string) => void
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return 'TODAY'

  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY'

  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }).toUpperCase()
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function ChatRoom({ roomId, onBack, onOpenProfile }: ChatRoomProps) {
  const [room, setRoom] = useState<RoomDetail | null>(null)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const lastSeen = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setRoom(await getRoom(roomId))
      setError(null)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not open this chat.')
    }
  }, [roomId])

  useEffect(() => {
    void load()
  }, [load])

  const joined = room?.joined ?? false

  useEffect(() => {
    if (!joined) return
    let cancelled = false

    const tick = async () => {
      try {
        const { messages: incoming } = await fetchRoomMessages(roomId, lastSeen.current)
        if (cancelled || !incoming.length) return
        lastSeen.current = incoming[incoming.length - 1].createdAt
        setMessages((prev) => [...prev, ...incoming])
      } catch {
        // A dropped poll isn't worth a banner; the next tick catches up.
      }
    }

    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [joined, roomId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setDraft('')
    try {
      await sendRoomMessage(roomId, body)
      const { messages: incoming } = await fetchRoomMessages(roomId, lastSeen.current)
      if (incoming.length) {
        lastSeen.current = incoming[incoming.length - 1].createdAt
        setMessages((prev) => [...prev, ...incoming])
      }
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Message not sent.')
      setDraft(body)
    }
  }

  async function join() {
    setBusy(true)
    try {
      await joinRoom(roomId)
      await load()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    setBusy(true)
    try {
      await leaveRoom(roomId)
      onBack()
    } finally {
      setBusy(false)
    }
  }

  async function report() {
    try {
      await reportTarget({
        targetType: 'activity',
        targetId: room?.refId ?? roomId,
        reason: 'inappropriate',
      })
      setMenuOpen(false)
      setError('Reported. Thanks — we look at these.')
    } catch {
      setError('Could not send the report.')
    }
  }

  // Day separators, computed once per render rather than inside the map.
  let lastDay = ''

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* --- header --- */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-2 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover"
          aria-label="Back to chats"
        >
          <Icon name="close" size={17} />
        </button>

        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-lg">
          {room?.emoji ?? '💬'}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{room?.title ?? 'Chat'}</p>
          <p className="tabular text-2xs text-muted">
            {room ? `${room.members.length} participant${room.members.length === 1 ? '' : 's'}` : '…'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover"
          aria-label="Room options"
        >
          <Icon name="shield" size={17} />
        </button>
      </header>

      {menuOpen && room && (
        <div className="shrink-0 border-b border-line bg-sunken px-3 py-2.5">
          <p className="eyebrow">Participants</p>
          {room.members.length === 0 ? (
            <p className="mt-1.5 text-2xs text-subtle">Nobody has joined yet.</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {/* Tappable, so you can look someone up before meeting them. */}
              {room.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenProfile?.(m.id)}
                  className="tag bg-surface text-muted hover:text-ink"
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex gap-2">
            {joined && (
              <button
                type="button"
                disabled={busy}
                onClick={leave}
                className="btn btn-secondary px-3 text-xs"
              >
                Leave chat
              </button>
            )}
            <button
              type="button"
              onClick={report}
              className="btn btn-ghost px-3 text-xs text-critical-ink"
            >
              Report
            </button>
          </div>
        </div>
      )}

      {/* --- RSVP strip, as in the reference design --- */}
      {room?.kind === 'activity' && joined && (
        <div className="shrink-0 border-b border-line py-2 text-center">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            ✋ <span>RSVP</span>
            <span className="text-2xs text-subtle">you're in</span>
          </span>
        </div>
      )}

      {/* --- messages --- */}
      <div ref={scrollRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <p className="notice mb-2 bg-critical-soft text-critical-ink">{error}</p>
        )}

        {!joined && room && (
          <div className="notice mt-4 bg-sunken text-center text-muted">
            <p className="font-medium text-ink">Join to see the conversation</p>
            <p className="mt-1 leading-relaxed">
              {room.kind === 'destination'
                ? `Everyone planning a trip to ${room.title} talks here.`
                : 'Members of this activity talk here.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={join}
              className="btn btn-primary mt-3 px-5 py-2.5"
            >
              Join chat
            </button>
          </div>
        )}

        {joined && messages.length === 0 && (
          <p className="mt-8 text-center text-xs leading-relaxed text-subtle">
            {room?.kind === 'destination'
              ? 'No messages yet. Say when you land.'
              : 'No messages yet. Anyone have ideas on what to do when you meet up?'}
          </p>
        )}

        <ul className="space-y-2">
          {messages.map((m) => {
            const day = dayLabel(m.createdAt)
            const showDay = day !== lastDay
            lastDay = day

            return (
              <li key={m.id}>
                {showDay && (
                  <p className="py-3 text-center text-[10px] font-medium tracking-wider text-subtle">
                    {day}
                  </p>
                )}
                <div
                  className={`flex items-end gap-2 ${
                    m.mine ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {/*
                    The sender's face beside their message, and tapping it opens
                    them. In a room full of strangers agreeing to meet, a name
                    alone is very little to go on.
                  */}
                  {!m.mine && (
                    <button
                      type="button"
                      onClick={() => onOpenProfile?.(m.userId)}
                      className="mb-4 flex h-8 w-8 shrink-0 items-center justify-center
                                 overflow-hidden rounded-full bg-sunken text-2xs font-semibold
                                 text-muted ring-1 ring-line"
                      aria-label={`Open ${m.name}'s profile`}
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
                    </button>
                  )}
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-2 ${
                      m.mine
                        ? 'rounded-br-md bg-inverse text-inverse-ink'
                        : 'rounded-bl-md border border-line bg-sunken'
                    }`}
                  >
                    {!m.mine && (
                      <button
                        type="button"
                        onClick={() => onOpenProfile?.(m.userId)}
                        className="text-2xs font-semibold text-accent-ink hover:underline"
                      >
                        {m.name}
                      </button>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                    <p
                      className={`tabular mt-0.5 text-[10px] ${
                        m.mine ? 'text-inverse-ink/60' : 'text-subtle'
                      }`}
                    >
                      {timeOf(m.createdAt)}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* --- composer --- */}
      {joined && (
        <form
          onSubmit={submit}
          className="sheet flex shrink-0 items-center gap-2 border-t border-line px-3 pt-2.5"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            maxLength={1000}
            className="field min-w-0 flex-1 !rounded-full"
            aria-label="Message"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
            aria-label="Send"
          >
            <Icon name="send" size={16} />
          </button>
        </form>
      )}
    </div>
  )
}
