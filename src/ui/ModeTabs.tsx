import Icon, { type IconName } from './Icon'

/**
 * The three modes, as one floating translucent group.
 *
 * A single frosted container with the active tab as a filled pill inside it,
 * rather than three separate chips. On a map the difference matters: separate
 * chips read as three unrelated controls scattered over the imagery, while one
 * container reads as a single switch with three positions — which is what it is.
 */

export interface ModeTab<T extends string> {
  key: T
  label: string
  icon: IconName
}

interface ModeTabsProps<T extends string> {
  tabs: ModeTab<T>[]
  value: T
  onChange: (key: T) => void
}

export default function ModeTabs<T extends string>({
  tabs,
  value,
  onChange,
}: ModeTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label="What you're looking for"
      className="pointer-events-auto inline-flex items-center gap-1 rounded-full
                 border border-white/40 bg-surface/70 p-1.5 shadow-mid backdrop-blur-xl
                 dark:border-white/10"
    >
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-2 rounded-full px-3.5 text-sm font-medium
                        transition-all duration-150 ease-out sm:px-4 ${
                          active
                            ? 'bg-inverse text-inverse-ink shadow-low'
                            : 'text-muted hover:bg-hover hover:text-ink'
                        }`}
            style={{ minHeight: '2.25rem' }}
          >
            <Icon name={tab.icon} size={16} />
            {/* The label is the whole point of the control, so it survives at
                phone width; only the horizontal padding tightens. */}
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
