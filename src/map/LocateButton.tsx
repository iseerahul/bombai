import Icon from '../ui/Icon'

/**
 * "Where am I", on the map itself.
 *
 * Location used to be reachable only from the icon tucked inside the Ask Map
 * search bar, which meant it did not exist at all in Hangout, Events or Trips —
 * and even in Ask Map it looked like part of the text field rather than a map
 * control. This is the button people actually go looking for, in the place
 * they go looking for it, in every mode.
 *
 * Three states, because "nothing happened" is the worst possible answer to
 * pressing it: idle, working (the fix can take several seconds indoors), and
 * located. Pressing it when already located recentres rather than toggling the
 * dot off — losing your position is never what that press meant.
 */
export default function LocateButton({
  state,
  onLocate,
}: {
  state: 'idle' | 'locating' | 'located'
  onLocate: () => void
}) {
  const located = state === 'located'
  const busy = state === 'locating'

  return (
    <div className="absolute right-2.5 top-[11rem] z-10 sm:right-3.5">
      <button
        type="button"
        onClick={onLocate}
        disabled={busy}
        aria-pressed={located}
        aria-label={located ? 'Recentre on your location' : 'Show your location'}
        title={located ? 'Recentre on your location' : 'Show your location'}
        className={`flex h-[29px] w-[29px] items-center justify-center rounded-full border
                    shadow-mid transition-colors ${
                      located
                        ? 'border-transparent bg-blue-600 text-white'
                        : 'border-white/40 bg-surface/80 text-muted backdrop-blur-xl hover:text-ink dark:border-white/10'
                    }`}
      >
        <Icon
          name="locate"
          size={15}
          className={busy ? 'animate-pulse-soft' : undefined}
        />
      </button>
    </div>
  )
}
