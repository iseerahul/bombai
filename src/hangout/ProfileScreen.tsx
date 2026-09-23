import { useRef, useState } from 'react'
import Icon from '../ui/Icon'
import { prepareAvatar } from '../board/photos'
import { type Me, HangoutError, signOut, updateProfile, uploadAvatar } from './api'

/**
 * Your profile, and the settings that matter.
 *
 * On "Get verified": MigoMap offers a selfie check. This does not pretend to
 * do that — there is no face matching here, and claiming one would be worse
 * than having none, because the badge would mean nothing while looking like it
 * meant something. What's offered instead is stated plainly.
 */

interface ProfileScreenProps {
  me: Me
  onUpdated: (me: Me) => void
  onSignedOut: () => void
}

export default function ProfileScreen({
  me,
  onUpdated,
  onSignedOut,
}: ProfileScreenProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(me.name)
  const [age, setAge] = useState(me.age ? String(me.age) : '')
  const [city, setCity] = useState(me.city ?? '')
  const [bio, setBio] = useState(me.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = Boolean(me.age && me.city && me.bio)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateProfile({
        name: name.trim() || me.name,
        age: age ? Number(age) : null,
        city: city.trim() || null,
        bio: bio.trim() || null,
      })
      onUpdated(updated)
      setEditing(false)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  /**
   * Change the profile picture.
   *
   * Squared and re-encoded on the device first: the avatar appears at 24–44 px
   * in chat rows and map bubbles, so a 6 MB phone photo would be absurd, and
   * cropping here means the stored bytes are the bytes we show everywhere.
   */
  async function pickPhoto(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    setPhotoError(null)
    try {
      const prepared = await prepareAvatar(file)
      const { avatarUrl } = await uploadAvatar(prepared.blob)
      URL.revokeObjectURL(prepared.previewUrl)
      onUpdated({ ...me, avatarUrl })
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not save that picture.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function logout() {
    try {
      await signOut()
    } catch {
      // Even if the call fails, drop the local state — the cookie is gone or
      // will expire, and leaving someone stuck "signed in" is worse.
    }
    onSignedOut()
  }

  return (
    <div className="scrollbar-slim h-full overflow-y-auto">
      {/* --- header --- */}
      <div className="relative bg-accent-soft px-4 pb-4 pt-6">
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="group relative flex h-24 w-24 items-center justify-center overflow-hidden
                       rounded-full bg-surface text-2xl font-semibold text-muted shadow-mid
                       disabled:opacity-60"
            aria-label="Change your profile picture"
          >
            {me.avatarUrl ? (
              <img
                src={me.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              me.name.slice(0, 1).toUpperCase()
            )}
            {/* Always visible, not hover-only: this is a phone-first app and
                a hover affordance is invisible to most of the audience. */}
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 py-1 text-2xs font-medium text-white">
              <Icon name={uploading ? 'clock' : 'plus'} size={11} />
              {uploading ? 'Saving' : 'Photo'}
            </span>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickPhoto(e.target.files)}
          />

          {photoError && (
            <p className="notice mt-2 bg-critical-soft text-critical-ink">{photoError}</p>
          )}
          <h1 className="mt-3 text-xl font-semibold tracking-[-0.02em]">{me.name}</h1>
          <p className="tabular mt-0.5 text-sm text-muted">
            {[me.age, me.city].filter(Boolean).join(' · ') || 'Add your age and city'}
          </p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn btn-secondary w-full py-2.5"
          >
            <Icon name="pin" size={15} />
            Edit profile
          </button>
        ) : (
          <form onSubmit={save} className="rounded-card border border-line bg-sunken p-3">
            <label className="block">
              <span className="eyebrow">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="field mt-1 w-full"
              />
            </label>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="eyebrow">Age</span>
                <input
                  type="number"
                  min={18}
                  max={120}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="field mt-1 w-full"
                />
              </label>
              <label className="block">
                <span className="eyebrow">City</span>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  maxLength={60}
                  className="field mt-1 w-full"
                />
              </label>
            </div>

            <label className="mt-2 block">
              <span className="eyebrow">About me</span>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="A line so others know who they're meeting"
                className="field mt-1 w-full resize-none"
              />
            </label>

            <p className="mt-1.5 text-2xs text-subtle">
              Age must be 18 or over. This app arranges meetings between strangers.
            </p>

            {error && (
              <p className="notice mt-2 bg-critical-soft text-critical-ink">{error}</p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="btn btn-secondary flex-1 py-2.5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn btn-primary flex-1 py-2.5 disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {/* --- the honest verification card --- */}
        <section
          className={`rounded-card border p-3 ${
            complete ? 'border-positive/40 bg-positive-soft' : 'border-line bg-sunken'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <Icon
              name={complete ? 'check' : 'shield'}
              size={16}
              className={complete ? 'mt-0.5 text-positive-ink' : 'mt-0.5 text-muted'}
            />
            <div className="min-w-0">
              <p
                className={`text-sm font-semibold ${
                  complete ? 'text-positive-ink' : ''
                }`}
              >
                {complete ? 'Profile complete' : 'Complete your profile'}
              </p>
              <p
                className={`mt-1 text-2xs leading-relaxed ${
                  complete ? 'text-positive-ink/80' : 'text-muted'
                }`}
              >
                {complete
                  ? 'Signed in with Google, with an age, city and bio filled in. That is exactly what this badge means — it is not an identity check, and nobody has verified who you are.'
                  : 'Add an age, city and a line about yourself. People decide whether to meet you from this.'}
              </p>
            </div>
          </div>
        </section>

        {/* --- about --- */}
        <section>
          <p className="eyebrow">About me</p>
          <p className="mt-1.5 rounded-card border border-line bg-surface p-3 text-sm leading-relaxed text-muted">
            {me.bio || 'Add a bio so others can get to know you.'}
          </p>
        </section>

        <button
          type="button"
          onClick={logout}
          className="btn btn-secondary w-full py-2.5 text-critical-ink"
        >
          Sign out
        </button>

        <p className="pb-2 text-center text-2xs leading-relaxed text-subtle">
          Signed in with Google. We keep your name and picture, and nothing else
          from your account.
        </p>
      </div>
    </div>
  )
}
