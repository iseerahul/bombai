import type { ReactNode } from 'react'

/**
 * The floating panel every mode docks into.
 *
 * Centred and bounded rather than pinned to the window edges. A full-width bar
 * on a 1440px screen puts the controls a long way from the map you are reading;
 * a centred column keeps them together and leaves the map visible around all
 * four sides, which is the point of a map-first layout.
 *
 * Translucent so the map stays legible underneath, with a blur so text on top
 * of it stays readable over anything — the two have to go together, since a
 * transparent panel without a blur is unreadable over dense map labels.
 */

interface FloatingPanelProps {
  children: ReactNode
  /** Narrower for a single input, wider when a row of cards sits inside. */
  size?: 'md' | 'lg'
  className?: string
}

export default function FloatingPanel({
  children,
  size = 'md',
  className = '',
}: FloatingPanelProps) {
  const width = size === 'lg' ? 'max-w-3xl' : 'max-w-xl'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 sm:px-4 sm:pb-5">
      <div
        className={`sheet pointer-events-auto w-full ${width} overflow-hidden rounded-sheet
                    border border-white/40 bg-surface/80 shadow-high backdrop-blur-xl
                    dark:border-white/10 ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
