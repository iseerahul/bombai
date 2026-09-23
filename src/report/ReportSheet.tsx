import { useEffect, useRef, useState } from 'react'
import type { FloodDepth, Poi, ReportKind } from '../types'
import { submitReport } from '../reports/api'
import Icon, { type IconName } from '../ui/Icon'

/**
 * Anonymous status reporting.
 *
 * Design constraint from the plan: reporting flooding must take under three
 * taps, because the person doing it is standing in the rain. So the flood path
 * is a single row of three depth buttons that submit immediately — no note
 * field to fill in, no confirmation step.
 */

export type ReportTarget =
  | { type: 'poi'; poi: Poi }
  | { type: 'point'; lat: number; lon: number }

interface ReportSheetProps {
  target: ReportTarget
  onClose: () => void
  onSubmitted: () => void
}

/*
 * Depth buttons escalate in colour the way the hazard escalates. The rising
 * bar next to each label repeats the same information without relying on
 * colour alone — this sheet gets used in bad light, in the rain, in a hurry.
 */
const DEPTHS: {
  key: FloodDepth
  label: string
  hint: string
  className: string
  bars: number
}[] = [
  {
    key: 'ankle',
    label: 'Ankle',
    hint: 'Passable on foot',
    className: 'border-caution/40 bg-caution-soft text-caution-ink hover:border-caution',
    bars: 1,
  },
  {
    key: 'knee',
    label: 'Knee',
    hint: 'Hard to cross',
    className: 'border-caution/60 bg-caution-soft text-caution-ink hover:border-caution',
    bars: 2,
  },
  {
    key: 'waist',
    label: 'Waist',
    hint: 'Do not enter',
    className: 'border-critical/40 bg-critical-soft text-critical-ink hover:border-critical',
    bars: 3,
  },
]

const POI_KINDS: {
  kind: ReportKind
  label: string
  icon: IconName
  className: string
}[] = [
  {
    kind: 'working',
    label: 'Working',
    icon: 'check',
    className: 'border-positive/40 bg-positive-soft text-positive-ink hover:border-positive',
  },
  {
    kind: 'broken',
    label: 'Broken',
    icon: 'alert',
    className: 'border-critical/40 bg-critical-soft text-critical-ink hover:border-critical',
  },
  {
    kind: 'closed',
    label: 'Closed',
    icon: 'close',
    className: 'border-line-strong bg-sunken text-muted hover:border-subtle',
  },
]

export default function ReportSheet({ target, onClose, onSubmitted }: ReportSheetProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape closes. A modal that traps you is worse than one that's easy to
  // dismiss, especially on the "standing in the rain" path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lat = target.type === 'poi' ? target.poi.lat : target.lat
  const lon = target.type === 'poi' ? target.poi.lon : target.lon

  async function send(kind: ReportKind, depth?: FloodDepth) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await submitReport({
        kind,
        lat,
        lon,
        poiId: target.type === 'poi' ? target.poi.id : null,
        depth: depth ?? null,
      })

      const hours = Math.round((result.expires_at - Date.now()) / 3600000)
      setDone(
        hours <= 24
          ? `Thanks — visible to others for about ${hours} hours, then it expires.`
          : `Thanks — recorded. It'll fade over the next few weeks unless confirmed.`
      )
      onSubmitted()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade-in items-end justify-center
                 bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="sheet w-full max-w-md animate-sheet-in rounded-t-sheet bg-surface p-4
                   shadow-high outline-none sm:rounded-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="report-title" className="text-lg font-semibold tracking-[-0.02em]">
              {target.type === 'poi' ? 'Report status' : 'Report flooding here'}
            </h2>
            <p className="tabular mt-0.5 truncate text-xs text-muted">
              {target.type === 'poi'
                ? (target.poi.name ?? 'Unnamed place')
                : `${lat.toFixed(3)}, ${lon.toFixed(3)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost -mr-1 -mt-1 aspect-square shrink-0 !rounded-full p-0"
            style={{ width: '2rem', height: '2rem', minHeight: 0 }}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {done ? (
          <div className="mt-4">
            <p className="flex items-start gap-2 rounded-card bg-positive-soft px-3 py-2.5 text-sm text-positive-ink">
              <Icon name="check" size={16} className="mt-0.5" />
              <span className="min-w-0">{done}</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary mt-3 w-full py-2.5"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {target.type === 'poi' && (
              <div className="mt-4">
                <p className="eyebrow">Is it working?</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {POI_KINDS.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      disabled={busy}
                      onClick={() => send(k.kind)}
                      className={`flex flex-col items-center gap-1 rounded-card border py-3
                                  text-sm font-medium transition-all duration-150 ease-out
                                  active:scale-[0.97] disabled:opacity-50 ${k.className}`}
                    >
                      <Icon name={k.icon} size={17} />
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <p className="eyebrow">Water on the road right now</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {DEPTHS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    disabled={busy}
                    onClick={() => send('flooded', d.key)}
                    className={`rounded-card border py-2.5 transition-all duration-150
                                ease-out active:scale-[0.97] disabled:opacity-50 ${d.className}`}
                  >
                    <span
                      className="mx-auto flex h-4 items-end justify-center gap-0.5"
                      aria-hidden
                    >
                      {[1, 2, 3].map((n) => (
                        <span
                          key={n}
                          className="w-1 rounded-sm bg-current transition-opacity"
                          style={{
                            height: `${n * 4 + 2}px`,
                            opacity: n <= d.bars ? 0.9 : 0.18,
                          }}
                        />
                      ))}
                    </span>
                    <span className="mt-1.5 block text-sm font-medium">{d.label}</span>
                    <span className="mt-0.5 block text-2xs opacity-80">{d.hint}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => send('clear')}
                className="btn btn-secondary mt-2 w-full py-2.5"
              >
                <Icon name="check" size={15} />
                It's clear here now
              </button>
            </div>

            {error && (
              <p className="notice mt-3 flex items-start gap-1.5 bg-critical-soft text-critical-ink">
                <Icon name="alert" size={13} className="mt-px" />
                <span className="min-w-0">{error}</span>
              </p>
            )}

            <p className="mt-3 flex items-start gap-1.5 text-2xs leading-relaxed text-subtle">
              <Icon name="shield" size={13} className="mt-px" />
              <span>
                Sent without any account or identifier. The location is rounded to
                about 110 m. Flooding reports disappear after 8 hours so nobody
                acts on yesterday's water.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
