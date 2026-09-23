import Icon from './Icon'
import { categoryColor } from '../config/categories'

/**
 * Results as a horizontal rail rather than a vertical list.
 *
 * On a map, a tall list covers the thing the results are about. A single row
 * scrolled sideways keeps the map visible and makes the count feel finite —
 * you swipe through six options rather than scrolling an unbounded feed.
 *
 * Each card carries the ranker's own explanation ("park · 310 m · open now").
 * That line is not decoration: it is the whole argument for a deterministic
 * ranker over a model, so it gets equal billing with the name.
 */

export interface RailItem {
  id: string
  label: string
  category: string
  /** Facts from the ranker, joined with middots. */
  why: string[]
}

interface ResultRailProps {
  items: RailItem[]
  selectedId?: string | null
  onSelect: (id: string) => void
}

export default function ResultRail({ items, selectedId, onSelect }: ResultRailProps) {
  if (!items.length) return null

  return (
    <div className="scrollbar-slim -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-0.5">
      {items.map((item) => {
        const active = item.id === selectedId
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`flex w-[13.5rem] shrink-0 snap-start items-center gap-2.5 rounded-card
                        border bg-surface px-3 py-2.5 text-left transition-all duration-150
                        hover:border-line-strong ${
                          active ? 'border-accent shadow-low' : 'border-line'
                        }`}
          >
            <span
              aria-hidden
              className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(item.category) }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{item.label}</span>
              <span className="tabular mt-0.5 block truncate text-2xs text-muted">
                {item.why.join(' · ')}
              </span>
            </span>
            <Icon name="external" size={14} className="shrink-0 text-subtle" />
          </button>
        )
      })}
    </div>
  )
}
