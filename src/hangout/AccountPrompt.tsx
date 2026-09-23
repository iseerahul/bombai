import { useState } from 'react'
import Icon from '../ui/Icon'
import { HangoutError, devSignIn, signInUrl } from './api'

/**
 * One-time account creation, inline.
 *
 * There is deliberately no sign-in wall. You can browse the map, search, plan
 * a route, and read what's on without an account. The moment you want to do
 * something that involves other people — join, post, message — this appears
 * once, and then you're done.
 *
 * That ordering matters: an account is the price of talking to strangers, not
 * the price of looking at a map.
 */

interface AccountPromptProps {
  /** What the account is needed for, phrased to finish "…to <purpose>". */
  purpose: string
  googleConfigured: boolean
  devAllowed: boolean
  onReady: () => void
  onCancel: () => void
}

export default function AccountPrompt({
  purpose,
  googleConfigured,
  devAllowed,
  onReady,
  onCancel,
}: AccountPromptProps) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2 || busy) return
    setBusy(true)
    setError(null)
    try {
      await devSignIn(name.trim())
      onReady()
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not create the account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
      onClick={onCancel}
    >
      <div
        className="sheet w-full max-w-sm animate-sheet-in rounded-t-sheet bg-surface p-5 shadow-high sm:rounded-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl">
          👋
        </span>

        <h2 id="account-title" className="mt-3 text-center text-lg font-semibold">
          Create your account
        </h2>
        <p className="mt-1.5 text-center text-sm leading-relaxed text-muted">
          One time, then you're in. You need it to {purpose} — everything else on
          the map works without one.
        </p>

        {googleConfigured && (
          <>
            <a
              href={signInUrl()}
              className="btn btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3 text-sm"
            >
              <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.0 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.0 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C39.2 36.5 44 31 44 24c0-1.3-.1-2.4-.4-3.5z"
                />
              </svg>
              Continue with Google
            </a>

            {devAllowed && (
              <p className="mt-3 text-center text-2xs text-subtle">or pick a name</p>
            )}
          </>
        )}

        {devAllowed && (
          <form onSubmit={create} className={googleConfigured ? 'mt-2' : 'mt-4'}>
            <input
              autoFocus={!googleConfigured}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Your name"
              className="field w-full"
              aria-label="Your name"
            />

            {error && (
              <p className="notice mt-2 bg-critical-soft text-critical-ink">{error}</p>
            )}

            <button
              type="submit"
              disabled={name.trim().length < 2 || busy}
              className={`btn mt-2 w-full py-3 disabled:opacity-40 ${
                googleConfigured ? 'btn-secondary' : 'btn-primary'
              }`}
            >
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
        )}

        {!googleConfigured && !devAllowed && (
          <p className="notice mt-4 bg-caution-soft text-caution-ink">
            Accounts aren't configured on this server yet.
          </p>
        )}

        <p className="mt-3 flex items-start gap-2 text-2xs leading-relaxed text-subtle">
          <Icon name="shield" size={13} className="mt-px shrink-0" />
          <span>
            No password to remember. We keep a name and, with Google, your
            profile picture — nothing else. You can sign out from Profile, and
            change your name or picture there at any time.
          </span>
        </p>

        <button
          type="button"
          onClick={onCancel}
          className="btn btn-ghost mt-1 w-full py-2 text-xs"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
