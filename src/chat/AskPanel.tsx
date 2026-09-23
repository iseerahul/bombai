import { useState } from 'react'
import Icon from '../ui/Icon'
import PinGlyph from '../ui/PinGlyph'
import FloatingPanel from '../ui/FloatingPanel'
import ResultRail, { type RailItem } from '../ui/ResultRail'
import type { Fix, Poi } from '../types'

/**
 * Ask the map.
 *
 * One input, a row of moods, and the answers as a rail. Deliberately not a
 * chat transcript: the old panel kept a conversation history because an LLM
 * round trip took seconds and the wait needed filling. Search is now instant
 * and local, so there is nothing to wait through and no reason to scroll back
 * — you ask, you get places, you ask again.
 *
 * The interpretation shows as editable chips. When the parser mishears you, you
 * correct it with one tap instead of rephrasing and guessing. A model would be
 * more flexible about phrasing; this is more honest about what it understood,
 * which on a pavement is worth more.
 */

interface AskPanelProps {
  results: Poi[]
  explanations: Record<string, string[]>
  /** What the parser understood, as removable chips. */
  chips: { key: string; label: string }[]
  busy: boolean
  notice: string | null
  selectedId: string | null
  userFix: Fix | null
  onAsk: (question: string) => void
  onRemoveChip: (key: string) => void
  onSelect: (id: string) => void
  onUseLocation: () => void
  /** Places the viewer has saved, for the My Map row. */
  visits: { id: string; photos: { id: string; url: string }[] }[]
  onOpenBoard: () => void
}

export default function AskPanel({
  results,
  explanations,
  chips,
  busy,
  notice,
  selectedId,
  userFix,
  onAsk,
  onRemoveChip,
  onSelect,
  onUseLocation,
  visits,
  onOpenBoard,
}: AskPanelProps) {
  const [draft, setDraft] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const question = draft.trim()
    if (!question || busy) return
    onAsk(question)
  }

  const items: RailItem[] = results.map((poi) => ({
    id: poi.id,
    label: poi.name ?? 'Unnamed place',
    category: poi.category,
    why: explanations[poi.id] ?? [],
  }))

  return (
    <FloatingPanel size={items.length ? 'lg' : 'md'}>
      <div className="px-3 pb-1 pt-3 sm:px-4">
        {/* --- results --- */}
        {items.length > 0 && (
          <div className="mb-2.5">
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <p className="tabular text-2xs text-subtle">
                {items.length} {items.length === 1 ? 'place' : 'places'}
              </p>
              {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {chips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => onRemoveChip(chip.key)}
                      className="tag bg-accent-soft text-accent-ink transition-opacity hover:opacity-70"
                      title={`Remove “${chip.label}” and search again`}
                    >
                      {chip.label}
                      <Icon name="close" size={10} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ResultRail items={items} selectedId={selectedId} onSelect={onSelect} />
          </div>
        )}

        {notice && (
          <p className="notice mb-2 bg-caution-soft text-caution-ink">{notice}</p>
        )}

        {/*
          The input is the whole interface now that the mood chips are gone, so
          it is sized like it: a single tall bar with the location and send
          controls tucked inside it rather than flanking it.
        */}
        <form onSubmit={submit} className="relative flex items-center">
          <button
            type="button"
            onClick={onUseLocation}
            aria-pressed={!!userFix}
            title={userFix ? 'Using your location' : 'Use your location'}
            className={`absolute left-2 flex h-10 w-10 shrink-0 items-center justify-center
                        rounded-full transition-colors ${
                          userFix
                            ? 'bg-accent-soft text-accent-ink'
                            : 'text-subtle hover:bg-hover hover:text-ink'
                        }`}
          >
            <Icon name="locate" size={18} />
          </button>

          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Somewhere chill near Bandra…"
            enterKeyHint="search"
            autoComplete="off"
            name="q"
            aria-label="What are you looking for?"
            className="field w-full pl-14 pr-14 text-base"
            style={{ minHeight: '3.5rem' }}
          />

          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Search"
            className="btn btn-accent absolute right-2 aspect-square shrink-0 !rounded-full p-0"
            style={{ width: '2.5rem', height: '2.5rem', minHeight: '2.5rem' }}
          >
            <Icon name="send" size={17} className={busy ? 'animate-pulse-soft' : ''} />
          </button>
        </form>

        {/*
          My Map.
          
          This is the feature people come back for, so it gets a named row of
          its own directly under the input rather than an icon in a toolbar.
          Empty, it explains itself; filled, it shows the last few photos,
          which is both the reward and the clearest possible label for what
          the thing is.
        */}
        <button
          type="button"
          onClick={onOpenBoard}
          className="group mt-2 flex w-full items-center gap-3 rounded-card border
                     border-accent/30 bg-accent-soft px-3 py-2.5 text-left
                     transition-colors hover:border-accent/60"
        >
          {/*
            The pin itself, not a pin on a coloured disc: this row is the entry
            point to the board, and the mark it shows should be the mark that
            appears on the map when you use it.
          */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center">
            <PinGlyph size={30} />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-accent-ink">Been here</span>
            <span className="tabular mt-0.5 block truncate text-2xs text-accent-ink/70">
              {visits.length === 0
                ? 'Save places you’ve been, with photos'
                : `${visits.length} ${visits.length === 1 ? 'place' : 'places'} visited`}
            </span>
          </span>

          {/* A stack of recent photos, overlapped so a few read as "more". */}
          {visits.length > 0 && (
            <span className="flex shrink-0 -space-x-2">
              {visits
                .flatMap((v) => v.photos)
                .slice(0, 3)
                .map((p) => (
                  <img
                    key={p.id}
                    src={p.url}
                    alt=""
                    className="h-8 w-8 rounded-full border-2 border-accent-soft object-cover"
                  />
                ))}
            </span>
          )}

          <Icon
            name="external"
            size={15}
            className="shrink-0 text-accent-ink/50 transition-transform group-hover:translate-x-0.5"
          />
        </button>

      </div>
    </FloatingPanel>
  )
}
