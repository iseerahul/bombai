import { useMemo, useState } from 'react'
import Icon, { type IconName } from '../ui/Icon'
import { distanceM, formatDistance } from '../search/localIndex'
import ChatScreen from './ChatScreen'
import TripsScreen from './TripsScreen'
import ProfileScreen from './ProfileScreen'
import {
  type ActivityCategory,
  type ActivitySummary,
  type DmThread,
  type Me,
  formatWhen,
  isLive,
} from './api'

/**
 * The hangout experience, as its own screen over the shared map.
 *
 * Explore keeps the map visible with its own floating controls and a list you
 * can pull up; the other sections take the screen, because a trip list, a chat
 * list and a profile have nothing to do with what's under them.
 *
 * The map itself is owned by App — one map for the whole product — so this
 * component draws chrome over it rather than instantiating its own.
 */

type Section = 'explore' | 'trips' | 'chats' | 'you'

const SECTIONS: { key: Section; label: string; icon: IconName }[] = [
  { key: 'explore', label: 'Explore', icon: 'pin' },
  { key: 'trips', label: 'Trips', icon: 'route' },
  { key: 'chats', label: 'Chats', icon: 'send' },
  { key: 'you', label: 'You', icon: 'shield' },
]

const CATEGORY_FILTERS: { key: ActivityCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sports', label: 'Sports' },
  { key: 'food', label: 'Food' },
  { key: 'study', label: 'Study' },
  { key: 'other', label: 'Other' },
]

interface HangoutHomeProps {
  me: Me | null
  activities: ActivitySummary[]
  loading: boolean
  error: string | null
  filter: ActivityCategory | 'all'
  selfLocation: { lat: number; lon: number } | null
  peopleCount: number
  googleConfigured: boolean
  devAllowed: boolean
  chatRefresh: number
  onFilter: (f: ActivityCategory | 'all') => void
  onOpenActivity: (id: string) => void
  onCreate: () => void
  onOpenRoom: (roomId: string) => void
  onOpenThread: (thread: DmThread) => void
  onMessagePerson: (userId: string) => void
  onChatChanged: () => void
  onProfileUpdated: (me: Me) => void
  onSignedOut: () => void
  onNeedAccount: (purpose: string, then: () => void) => void
}

export default function HangoutHome(props: HangoutHomeProps) {
  const {
    me,
    activities,
    loading,
    error,
    filter,
    selfLocation,
    peopleCount,
    googleConfigured,
    devAllowed,
    chatRefresh,
    onFilter,
    onOpenActivity,
    onCreate,
      onOpenRoom,
    onOpenThread,
    onMessagePerson,
    onChatChanged,
    onProfileUpdated,
    onSignedOut,
    onNeedAccount,
  } = props

  const [section, setSection] = useState<Section>('explore')

  const withDistance = useMemo(() => {
    if (!selfLocation) return activities
    return activities
      .map((a) => ({
        ...a,
        distanceM: distanceM(selfLocation.lat, selfLocation.lon, a.lat, a.lon),
      }))
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
  }, [activities, selfLocation])

  /** Sections that involve other people ask for an account first. */
  function goTo(target: Section) {
    if (target === 'explore' || me) {
      setSection(target)
      return
    }
    onNeedAccount(
      target === 'trips'
        ? 'plan trips with people'
        : target === 'chats'
          ? 'chat with people'
          : 'have a profile',
      () => setSection(target)
    )
  }

  return (
    <>
      {/* --- explore: one floating panel over the live map --- */}
      {section === 'explore' && (
        <>

          <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-3 pb-3 sm:px-4">
            <div
              className="sheet pointer-events-auto w-full max-w-3xl overflow-hidden rounded-sheet
                         border border-white/40 bg-surface/80 shadow-high backdrop-blur-xl
                         dark:border-white/10"
            >
              <div className="px-3 pb-1 pt-3 sm:px-4">
                {/* --- filters --- */}
                <div className="scrollbar-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
                  {CATEGORY_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => onFilter(f.key)}
                      className={`chip shrink-0 ${filter === f.key ? 'chip-active' : 'chip-idle'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* --- state lines --- */}
                {error && (
                  <p className="notice mb-2 bg-critical-soft text-critical-ink">{error}</p>
                )}
                {loading && withDistance.length === 0 && (
                  <p className="py-4 text-center text-xs text-subtle">Loading…</p>
                )}
                {!loading && withDistance.length === 0 && !error && (
                  <p className="notice mb-2 bg-sunken text-muted">
                    <span className="font-medium text-ink">Nothing on yet.</span>{' '}
                    Be the first — tap + and pick a park, a café, a station.
                  </p>
                )}

                {/* --- the rail --- */}
                {withDistance.length > 0 && (
                  <>
                    <div className="mb-1.5 flex items-center justify-between px-0.5">
                      <p className="tabular text-2xs text-subtle">
                        {withDistance.length}{' '}
                        {withDistance.length === 1 ? 'activity' : 'activities'}
                        {selfLocation ? ' · nearest first' : ''}
                      </p>
                      {peopleCount > 0 && (
                        <span className="tabular inline-flex items-center gap-1.5 text-2xs text-muted">
                          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
                          {peopleCount} sharing
                        </span>
                      )}
                    </div>

                    <div className="scrollbar-slim -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
                      {withDistance.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => onOpenActivity(a.id)}
                          className="flex w-[15rem] shrink-0 snap-start items-center gap-2.5
                                     rounded-card border border-line bg-surface px-3 py-2.5
                                     text-left transition-colors hover:border-line-strong"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-lg">
                            {a.emoji}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                {a.title}
                              </span>
                              {isLive(a) && (
                                <span className="h-1.5 w-1.5 shrink-0 animate-pulse-soft rounded-full bg-positive" />
                              )}
                            </span>
                            <span className="tabular mt-0.5 block truncate text-2xs text-muted">
                              {formatWhen(a.startsAt)}
                              {a.distanceM != null && ` · ${formatDistance(a.distanceM)}`}
                              {` · ${a.approvedCount}/${a.capacity}`}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* --- create --- */}
                <button
                  type="button"
                  onClick={() =>
                    me ? onCreate() : onNeedAccount('create an activity', onCreate)
                  }
                  className="btn btn-accent mt-2 w-full"
                  style={{ minHeight: '2.5rem' }}
                >
                  <Icon name="plus" size={16} />
                  Start something
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* --- the other sections take the screen --- */}
      {section !== 'explore' && (
        <section className="absolute inset-x-0 bottom-16 top-0 z-20 flex flex-col bg-canvas">
          {section === 'trips' && (
            <TripsScreen
              onMessage={onMessagePerson}
              onOpenRoom={onOpenRoom}
              onChanged={onChatChanged}
            />
          )}

          {section === 'chats' && (
            <ChatScreen
              onOpenRoom={onOpenRoom}
              onOpenThread={onOpenThread}
              refreshKey={chatRefresh}
            />
          )}

          {section === 'you' &&
            (me ? (
              <ProfileScreen
                me={me}
                onUpdated={onProfileUpdated}
                onSignedOut={onSignedOut}
              />
            ) : (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium">No account yet</p>
                <p className="mx-auto mt-1.5 max-w-[18rem] text-xs leading-relaxed text-muted">
                  {googleConfigured || devAllowed
                    ? 'Create one to join activities, plan trips and message people.'
                    : 'Accounts are not configured on this server yet.'}
                </p>
              </div>
            ))}
        </section>
      )}

      {/* --- bottom navigation --- */}
      <nav
        className="sheet absolute inset-x-0 bottom-0 z-30 flex items-stretch border-t
                   border-white/40 bg-surface/80 px-2 pt-1.5 backdrop-blur-xl dark:border-white/10"
        aria-label="Hangout sections"
      >
        {SECTIONS.map((s) => {
          const active = section === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => goTo(s.key)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                active ? 'text-accent' : 'text-subtle hover:text-muted'
              }`}
            >
              {s.key === 'you' && me?.avatarUrl ? (
                <img
                  src={me.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`h-[18px] w-[18px] rounded-full object-cover ${
                    active ? 'ring-2 ring-accent' : ''
                  }`}
                />
              ) : (
                <Icon name={s.icon} size={18} />
              )}
              {s.label}
            </button>
          )
        })}
      </nav>
    </>
  )
}
