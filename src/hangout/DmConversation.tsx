import { useEffect, useRef, useState } from 'react'
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
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const { messages: incoming } = await fetchDm(thread.id, lastSeen.current)
        if (cancelled || !incoming.length) return
        lastSeen.current = incoming[incoming.length - 1].createdAt
        setMessages((prev) => [...prev, ...incoming])
      } catch (err) {
        if (err instanceof HangoutError && err.code === 'blocked') {
          setError("You can't message this person.")
        }
      }
    }
    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [thread.id])

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
      const { messages: incoming } = await fetchDm(thread.id, lastSeen.current)
      if (incoming.length) {
        lastSeen.current = incoming[incoming.length - 1].createdAt
        setMessages((prev) => [...prev, ...incoming])
      }
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
