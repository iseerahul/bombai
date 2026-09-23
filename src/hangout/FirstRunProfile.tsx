import { useState } from 'react'
import Icon from '../ui/Icon'
import { type Me, HangoutError, updateProfile } from './api'

/**
 * The one screen shown straight after a first Google sign-in.
 *
 * Google hands us a name and a photo, so this is a confirmation rather than a
 * form: everything is pre-filled and the primary button says "Looks good".
 * Someone who just wanted to save a café should be back at that café in one
 * tap, not filling in fields.
 *
 * Age and neighbourhood are here because this app puts strangers in the same
 * room — an activity, an event chat — and both are the only context anyone
 * gets about who they are talking to. They are still skippable: a profile
 * that blocks the thing you came to do is a profile people abandon.
 */

interface FirstRunProfileProps {
  me: Me
  /** What they were trying to do when sign-in interrupted them. */
  purpose?: string | null
  onDone: (me: Me) => void
}

const CITY_HINTS = [
  'Bandra',
  'Andheri',
  'Dadar',
  'Colaba',
  'Powai',
  'Thane',
  'Navi Mumbai',
]

export default function FirstRunProfile({ me, purpose, onDone }: FirstRunProfileProps) {
  const [name, setName] = useState(me.name ?? '')
  const [age, setAge] = useState(me.age ? String(me.age) : '')
  const [city, setCity] = useState(me.city ?? '')
  const [bio, setBio] = useState(me.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('A name of some kind, please — it is what people see.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const parsedAge = Number(age)
      const updated = await updateProfile({
        name: trimmed,
        age: Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge : null,
        city: city.trim() || null,
        bio: bio.trim() || null,
      })
      onDone(updated)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not save that.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Set up your profile"
    >
      <form
        onSubmit={save}
        className="sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-sheet
                   border-t border-line bg-surface shadow-sheet
                   sm:max-w-md sm:rounded-sheet sm:border"
      >
        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-6">
          {/* --- who Google says you are --- */}
          <div className="flex items-center gap-3.5">
            <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken">
              {me.avatarUrl ? (
                <img
                  src={me.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-semibold text-muted">
                  {(name || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-positive text-white ring-2 ring-surface">
                <Icon name="check" size={13} />
              </span>
            </span>

            <div className="min-w-0">
              <p className="eyebrow">You're in</p>
              <h2 className="truncate text-lg font-semibold">
                {me.name ? `Hi, ${me.name.split(' ')[0]}` : 'Nearly there'}
              </h2>
              {me.email && (
                <p className="truncate text-2xs text-subtle">{me.email}</p>
              )}
            </div>
          </div>

          {purpose && (
            <p className="notice mt-3 bg-accent-soft text-accent-ink">
              Finish this and you'll go straight back to {purpose}.
            </p>
          )}

          {/* --- name --- */}
          <label className="eyebrow mt-5 block" htmlFor="fr-name">
            What should people call you?
          </label>
          <input
            id="fr-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            className="field mt-1.5"
            autoComplete="name"
            placeholder="Your name"
          />

          {/* --- age and area --- */}
          <div className="mt-4 grid grid-cols-[6rem_1fr] gap-2.5">
            <div>
              <label className="eyebrow block" htmlFor="fr-age">
                Age
              </label>
              <input
                id="fr-age"
                value={age}
                onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric"
                className="field mt-1.5"
                placeholder="—"
              />
            </div>
            <div>
              <label className="eyebrow block" htmlFor="fr-city">
                Where in the city?
              </label>
              <input
                id="fr-city"
                value={city}
                onChange={(e) => setCity(e.target.value.slice(0, 40))}
                className="field mt-1.5"
                placeholder="Your area"
              />
            </div>
          </div>

          <div className="scrollbar-slim -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {CITY_HINTS.map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => setCity(hint)}
                className={`chip shrink-0 ${city === hint ? 'chip-active' : 'chip-idle'}`}
              >
                {hint}
              </button>
            ))}
          </div>

          {/* --- bio --- */}
          <label className="eyebrow mt-4 block" htmlFor="fr-bio">
            One line about you <span className="normal-case opacity-60">(optional)</span>
          </label>
          <textarea
            id="fr-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 160))}
            rows={2}
            className="field mt-1.5 resize-none rounded-card py-2.5"
            placeholder="Always looking for a decent filter coffee."
          />

          <p className="mt-3 flex items-start gap-2 text-2xs leading-relaxed text-subtle">
            <Icon name="info" size={13} className="mt-px shrink-0" />
            <span>
              Your name, photo and area are shown to people in activities and
              chats you join. Your email never is. You can change or delete all
              of it from your profile.
            </span>
          </p>

          {error && (
            <p className="notice mt-3 bg-critical-soft text-critical-ink">{error}</p>
          )}
        </div>

        <div className="divider shrink-0 bg-surface px-5 pt-3">
          <button
            type="submit"
            disabled={busy}
            className="btn btn-accent w-full"
            style={{ minHeight: '2.75rem' }}
          >
            {busy ? 'Saving…' : 'Looks good'}
          </button>
          {/*
            An explicit skip, because the details are genuinely optional and a
            profile form standing between someone and the thing they came to do
            is how you lose them on the first visit.
          */}
          <button
            type="button"
            onClick={() => onDone(me)}
            className="btn btn-ghost mt-1 w-full py-2 text-xs"
          >
            Skip for now
          </button>
        </div>
      </form>
    </div>
  )
}
