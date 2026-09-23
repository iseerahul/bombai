import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import {
  type DmMessage,
  type DmThread,
  HangoutError,
  blockUser,
  fetchDm,
  reportTarget,
  sendDm,
} from './api'

/**
 * A one-to-one conversation, full screen.
 *
 * Block and report live inside the conversation rather than three menus deep,
 * because the moment you need them is the moment you're reading the message.
 */

const POLL_MS = 4000

/**
 * Append only what we don't already have.
 *
 * `since` is a timestamp, so anything written in the same millisecond as the
 * last row we saw comes back twice; ids are the only thing that actually
 * identifies a message. Returning `prev` unchanged when there is nothing new
 * keeps the scroll-to-bottom effect from firing on every poll.
 */
function mergeById(prev: DmMessage[], incoming: DmMessage[]): DmMessage[] {
  const seen = new Set(prev.map((m) => m.id))
  const fresh = incoming.filter((m) => !seen.has(m.id))
  return fresh.length ? [...prev, ...fresh] : prev
}

interface DmConversationProps {
  thread: DmThread
  onBack: () => void
  onBlocked: () => void
}

export default function DmConversation({
  thread,
  onBack,
  onBlocked,
}: DmConversationProps) {
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const lastSeen = useRef(0)
  /*
   * `lastSeen` only moves once a fetch resolves, so two overlapping fetches ask
   * for the same `since` and come back with the same rows. This holds the one
   * fetch that is allowed to be running; anyone else joins it instead of
   * starting a second. Merging by id covers what it can't.
   */
  const inFlight = useRef<Promise<void> | null>(null)
  const threadRef = useRef(thread.id)
  threadRef.current = thread.id
  const scrollRef = useRef<HTMLDivElement>(null)

  const pump = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const id = thread.id
    const run = (async () => {
      try {
        const { messages: incoming } = await fetchDm(id, lastSeen.current)
        // A response for a conversation we've since left isn't this list.
        if (threadRef.current !== id || !incoming.length) return
        lastSeen.current = Math.max(
          lastSeen.current,
          incoming[incoming.length - 1].createdAt
        )
        setMessages((prev) => mergeById(prev, incoming))
      } catch (err) {
        if (err instanceof HangoutError && err.code === 'blocked') {
          setError("You can't message this person.")
        }
      }
    })()
    inFlight.current = run.finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [thread.id])

  useEffect(() => {
    void pump()
    const timer = window.setInterval(() => void pump(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [pump])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setDraft('')
    try {
      await sendDm(thread.id, body)
      // A poll that was already running asked the server before this message
      // existed, so let it finish and then fetch again — otherwise your own
      // message doesn't show until the next tick.
      if (inFlight.current) await inFlight.current
      await pump()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Message not sent.')
      setDraft(body)
    }
  }

  async function block() {
    try {
      await blockUser(thread.otherId, true)
      onBlocked()
    } catch {
      setError('Could not block.')
    }
  }

  async function report() {
    try {
      // Reporting blocks too — nobody reports someone then wants to keep
      // hearing from them while a queue is reviewed.
      await reportTarget({
        targetType: 'user',
        targetId: thread.otherId,
        reason: 'harassment',
      })
      onBlocked()
    } catch {
      setError('Could not send the report.')
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-2 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover"
          aria-label="Back to chats"
        >
          <Icon name="close" size={17} />
        </button>

        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken text-sm font-semibold text-muted">
          {thread.otherAvatar ? (
            <img
              src={thread.otherAvatar}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            thread.otherName.slice(0, 1).toUpperCase()
          )}
        </span>

        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{thread.otherName}</p>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover"
          aria-label="Conversation options"
        >
          <Icon name="shield" size={17} />
        </button>
      </header>

      {menuOpen && (
        <div className="shrink-0 border-b border-line bg-sunken px-3 py-2.5">
          <p className="text-2xs leading-relaxed text-muted">
            Blocking hides you from each other everywhere — map, chats and
            activities.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={block} className="btn btn-secondary px-3 text-xs">
              Block {thread.otherName}
            </button>
            <button
              type="button"
              onClick={report}
              className="btn btn-secondary px-3 text-xs text-critical-ink"
            >
              Report
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error && <p className="notice mb-2 bg-critical-soft text-critical-ink">{error}</p>}

        {messages.length === 0 && (
          <p className="py-8 text-center text-2xs text-subtle">No messages yet.</p>
        )}

        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={m.mine ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 ${
                  m.mine
                    ? 'rounded-br-md bg-inverse text-inverse-ink'
                    : 'rounded-bl-md border border-line bg-sunken'
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                <p
                  className={`tabular mt-0.5 text-[10px] ${
                    m.mine ? 'text-inverse-ink/60' : 'text-subtle'
                  }`}
                >
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

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
    </div>
  )
}
