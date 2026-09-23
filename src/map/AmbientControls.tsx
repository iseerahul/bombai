import { useState } from 'react'
import Icon, { type IconName } from '../ui/Icon'
import { AMBIENT_OFF, type AmbientConfig } from './ambient'

/**
 * The life-on-the-map controls, docked under MapLibre's zoom buttons.
 *
 * Collapsed to a single button by default. This is play, not a tool — it
 * should be findable by someone poking around and invisible to someone trying
 * to find a toilet in the rain.
 */

const EFFECTS: { key: keyof Omit<AmbientConfig, 'weather'>; label: string; icon: IconName }[] = [
  { key: 'clouds', label: 'Clouds', icon: 'shelter' },
  { key: 'birds', label: 'Birds', icon: 'sparkle' },
  { key: 'boats', label: 'Boats', icon: 'waterfront' },
  { key: 'trains', label: 'Trains', icon: 'rail' },
  { key: 'kites', label: 'Kites', icon: 'sparkle' },
  { key: 'planes', label: 'Planes', icon: 'route' },
]

const WEATHER: { key: AmbientConfig['weather']; label: string; icon: IconName }[] = [
  { key: null, label: 'Clear', icon: 'sparkle' },
  { key: 'rain', label: 'Rain', icon: 'flood' },
  { key: 'snow', label: 'Winter', icon: 'water' },
  { key: 'autumn', label: 'Autumn', icon: 'park' },
  { key: 'festival', label: 'Festival', icon: 'coin' },
]

interface AmbientControlsProps {
  config: AmbientConfig
  onChange: (next: AmbientConfig) => void
}

export default function AmbientControls({ config, onChange }: AmbientControlsProps) {
  const [open, setOpen] = useState(false)

  const activeCount =
    EFFECTS.filter((e) => config[e.key]).length + (config.weather ? 1 : 0)

  return (
    <div className="absolute right-2.5 top-[7.5rem] z-10 flex flex-col items-end gap-2 sm:right-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Life on the map"
        className={`relative flex h-[29px] w-[29px] items-center justify-center rounded-full
                    border shadow-mid transition-colors ${
                      open || activeCount > 0
                        ? 'border-transparent bg-inverse text-inverse-ink'
                        : 'border-white/40 bg-surface/80 text-muted backdrop-blur-xl hover:text-ink dark:border-white/10'
                    }`}
      >
        <Icon name="sparkle" size={15} />
        {activeCount > 0 && !open && (
          <span
            className="tabular absolute -right-1 -top-1 flex h-4 min-w-4 items-center
                       justify-center rounded-full bg-accent px-1 text-[9px]
                       font-bold text-white"
          >
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="w-44 animate-slide-up rounded-card border border-white/40 bg-surface/85
                     p-2 shadow-high backdrop-blur-xl dark:border-white/10"
        >
          <p className="eyebrow px-1 pb-1.5">On the map</p>
          <div className="grid grid-cols-2 gap-1">
            {EFFECTS.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => onChange({ ...config, [e.key]: !config[e.key] })}
                aria-pressed={config[e.key]}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-2xs
                            font-medium transition-colors ${
                              config[e.key]
                                ? 'bg-accent text-white'
                                : 'bg-sunken text-muted hover:text-ink'
                            }`}
              >
                <Icon name={e.icon} size={13} />
                {e.label}
              </button>
            ))}
          </div>

          <p className="eyebrow px-1 pb-1.5 pt-2.5">Season</p>
          <div className="grid grid-cols-2 gap-1">
            {WEATHER.map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => onChange({ ...config, weather: w.key })}
                aria-pressed={config.weather === w.key}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-2xs
                            font-medium transition-colors ${
                              config.weather === w.key
                                ? 'bg-inverse text-inverse-ink'
                                : 'bg-sunken text-muted hover:text-ink'
                            }`}
              >
                <Icon name={w.icon} size={13} />
                {w.label}
              </button>
            ))}
          </div>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(AMBIENT_OFF)}
              className="btn btn-ghost mt-2 w-full text-2xs"
              style={{ minHeight: '1.75rem' }}
            >
              Turn all off
            </button>
          )}
        </div>
      )}
    </div>
  )
}
