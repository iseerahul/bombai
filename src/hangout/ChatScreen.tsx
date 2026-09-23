import { useCallback, useEffect, useState } from 'react'
import Icon from '../ui/Icon'
import {
  type DmThread,
  type Room,
  HangoutError,
  listRooms,
  listThreads,
  relativeShort,
} from './api'

/**
 * Chats — group rooms and direct messages, in one list.
 *
 * Rooms come in two kinds and the list doesn't separate them by default,
 * because from the user's side they're the same thing: a group you're in.
 * The filters are there when you want them.
 */

type Filter = 'all' | 'activities' | 'trips' | 'dms'

interface ChatScreenProps {
  /** Open a group room full screen. */
  onOpenRoom: (roomId: string) => void
  /** Open a one-to-one conversation. */
  onOpenThread: (thread: DmThread) => void
  /** Bump to force a reload — e.g. after joining something elsewhere. */
  refreshKey: number
}

export default function ChatScreen({
  onOpenRoom,
  onOpenThread,
  refreshKey,
}: ChatScreenProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [rooms, setRooms] = useState<Room[]>([])
  const [threads, setThreads] = useState<DmThread[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [roomRes, threadRes] = await Promise.all([
        listRooms(),
        listThreads().catch(() => ({ threads: [] as DmThread[] })),
      ])
      setRooms(roomRes.rooms)
      setThreads(threadRes.threads)
      setError(null)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not load chats.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  // Poll while the tab is open so a new message shows without a manual refresh.
  useEffect(() => {
    const timer = window.setInterval(refresh, 20_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const q = query.trim().toLowerCase()

  const shownRooms = rooms.filter((r) => {
    if (filter === 'dms') return false
    if (filter === 'activities' && r.kind !== 'activity') return false
    if (filter === 'trips' && r.kind !== 'destination') return false
    if (!q) return true
    return (
      r.title.toLowerCase().includes(q) ||
      (r.lastBody ?? '').toLowerCase().includes(q)
    )
  })

  const shownThreads = threads.filter((t) => {
    if (filter === 'activities' || filter === 'trips') return false
    if (!q) return true
    return (
      t.otherName.toLowerCase().includes(q) ||
      (t.lastBody ?? '').toLowerCase().includes(q)
    )
  })

  const empty = shownRooms.length === 0 && shownThreads.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pb-2 pt-3">
        <h1 className="text-lg font-semibold tracking-[-0.02em]">Chats</h1>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages…"
          className="field mt-2.5 w-full"
          aria-label="Search messages"
        />

        <div className="scrollbar-slim -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'activities', label: 'Activities' },
              { key: 'trips', label: 'Trips' },
              { key: 'dms', label: 'DMs' },
            ] as { key: Filter; label: string }[]
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`chip shrink-0 ${filter === f.key ? 'chip-active' : 'chip-idle'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {error && <p className="notice bg-critical-soft text-critical-ink">{error}</p>}

        {loading && empty && (
          <p className="py-8 text-center text-xs text-subtle">Loading chats…</p>
        )}

        {!loading && empty && !error && (
          <div className="notice mt-3 bg-sunken text-muted">
            <p className="font-medium text-ink">No conversations yet.</p>
            <p className="mt-1 leading-relaxed">
              Tap “I'm in” on an activity, or plan a trip — both put you in a
              group chat. You can also message someone from the map.
            </p>
          </div>
        )}

        <ul className="divide-y divide-line">
          {shownRooms.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpenRoom(r.id)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sunken text-lg">
                  {r.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{r.title}</span>
                  <span className="block truncate text-2xs text-muted">
                    {r.lastBody
                      ? `${r.lastName ? `${r.lastName}: ` : ''}${r.lastBody}`
                      : `${r.members} member${r.members === 1 ? '' : 's'} · no messages yet`}
                  </span>
                </span>
                <span className="tabular shrink-0 text-2xs text-subtle">
                  {r.lastAt ? relativeShort(r.lastAt) : ''}
                </span>
              </button>
            </li>
          ))}

          {shownThreads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpenThread(t)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken text-sm font-semibold text-muted">
                  {t.otherAvatar ? (
                    <img
                      src={t.otherAvatar}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    t.otherName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {t.otherName}
                  </span>
                  <span className="block truncate text-2xs text-muted">
                    {t.lastBody ?? 'No messages yet'}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Icon name="send" size={11} className="text-subtle" />
                  <span className="tabular text-2xs text-subtle">
                    {t.lastBody ? relativeShort(t.lastAt) : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
