import { useCallback, useEffect, useState } from 'react'
import Icon from '../ui/Icon'
import {
  type ActivityDetail,
  HangoutError,
  deleteActivity,
  formatWhen,
  getActivity,
  joinActivity,
  leaveActivity,
  reportTarget,
  weekdayOf,
} from './api'

/**
 * One activity.
 *
 * The chat is no longer embedded here — it opens as a full room, because a
 * conversation squeezed under a details panel is never usable. This sheet is
 * the invitation; the room is the conversation.
 *
 * Joining is one tap ("I'm in"). There is no approval queue: the organiser's
 * control is that they can delete the activity, which removes it and its chat
 * for everyone.
 */

interface ActivitySheetProps {
  activityId: string
  /**
   * Signed-in state and the account prompt, exactly as EventSheet takes them:
   * without these, tapping "I'm in" signed out ended at "Sign in to do that."
   * with no way to sign in. Both are optional so the sheet still works if they
   * aren't passed — it then assumes you're signed in and lets the server's
   * error speak, which is the old behaviour.
   */
  signedIn?: boolean
  onNeedAccount?: (purpose: string, then: () => void) => void
  onClose: () => void
  onChanged: () => void
  onOpenRoom: (roomId: string) => void
  onOpenProfile: (userId: string) => void
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function ActivitySheet({
  activityId,
  signedIn = true,
  onNeedAccount,
  onClose,
  onChanged,
  onOpenRoom,
  onOpenProfile,
}: ActivitySheetProps) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      setDetail(await getActivity(activityId))
      setError(null)
    } catch (err) {
      setError(err instanceof HangoutError ? err.message : 'Could not load this activity.')
    }
  }, [activityId])

  useEffect(() => {
    void load()
  }, [load])

  const isIn = detail?.myStatus === 'approved' || detail?.isMine === true
  const full = detail ? detail.approvedCount >= detail.capacity : false

  function join() {
    // Offer the account first, then carry on into the join you asked for. The
    // resumed call goes straight to the join rather than back through here: by
    // then this closure still holds the old signedIn and would ask again.
    if (!signedIn && onNeedAccount) {
      onNeedAccount('join this', () => void doJoin())
      return
    }
    void doJoin()
  }

  async function doJoin() {
    setBusy(true)
    setError(null)
    try {
      const { roomId } = await joinActivity(activityId)
      await load()
      onChanged()
      // Straight into the conversation — that's the point of joining.
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
      await leaveActivity(activityId)
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
      await deleteActivity(activityId)
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
      await reportTarget({ targetType: 'activity', targetId: activityId, reason })
      setNotice('Reported. Thanks — we look at these.')
    } catch {
      setError('Could not send the report.')
    }
  }

  const organiser = detail?.members.find((m) => m.id === detail.creatorId)

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
        {/* --- report · emoji · close --- */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-3">
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-muted transition-colors hover:text-critical-ink"
            aria-label="Report this activity"
          >
            <Icon name="flag" size={14} />
          </button>

          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sunken text-3xl">
            {detail?.emoji ?? '🎉'}
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
            <p className="text-xs font-semibold">Report this activity</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Spam', 'Unsafe', 'Harassment', 'Not real'].map((reason) => (
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
              <span className="text-accent-ink">{organiser?.name ?? 'Someone'}</span>{' '}
              <span className="font-normal text-muted">wants to</span>{' '}
              {detail?.title ?? '…'}{' '}
              {detail && (
                <span className="font-normal text-muted">
                  on {weekdayOf(detail.startsAt)}
                </span>
              )}
            </h2>

            {detail && (
              <>
                <p className="tabular mt-1.5 text-xs text-muted">
                  {formatWhen(detail.startsAt)} · {timeOf(detail.endsAt)}
                </p>
                <p className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
                  <Icon name="pin" size={12} />
                  {detail.venueName}
                  <span className="tag bg-info-soft text-info-ink">Verified venue</span>
                </p>

                <p className="mt-3 text-sm font-medium">
                  {detail.approvedCount} going 🎉
                  {full && <span className="ml-1 text-caution-ink">· full</span>}
                </p>

                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {detail.members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onOpenProfile(m.id)}
                      className="relative flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-sm font-semibold text-muted transition-transform hover:scale-105"
                      title={m.name}
                    >
                      {m.name.slice(0, 1).toUpperCase()}
                      {m.id === detail.creatorId && (
                        <span className="absolute -bottom-1 text-xs">👑</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}

            {detail?.note && (
              <p className="notice mt-3 bg-sunken text-left text-muted">{detail.note}</p>
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
              <p className="font-semibold">Delete this activity?</p>
              <p className="mt-1 leading-relaxed">
                It disappears for everyone, along with the chat and everything in
                it. This cannot be undone.
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

        {/* --- actions --- */}
        <div className="sheet shrink-0 border-t border-line px-4 pt-2.5">
          {detail && (
            <>
              {isIn ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => detail.roomId && onOpenRoom(detail.roomId)}
                    disabled={!detail.roomId}
                    className="btn btn-primary flex-1 py-3 disabled:opacity-50"
                  >
                    <Icon name="send" size={15} />
                    Chat
                  </button>

                  {detail.isMine ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="btn btn-secondary px-4 py-3 text-critical-ink"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={leave}
                      className="btn btn-secondary px-4 py-3"
                    >
                      Leave
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={join}
                  disabled={busy || full}
                  className="btn btn-primary w-full py-3 disabled:opacity-40"
                >
                  {full ? 'Full' : busy ? 'Joining…' : "I'm in"}
                </button>
              )}
            </>
          )}

          <p className="mt-1.5 text-center text-2xs text-subtle">
            Meet at the venue, in public. This and its chat disappear a couple of
            hours after it ends.
          </p>
        </div>
      </div>
    </div>
  )
}
