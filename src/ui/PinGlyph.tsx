import { useId } from 'react'
import { visitPinSvg } from '../map/markers'

/**
 * The "Been here" pin, at icon size.
 *
 * The same drawing as the marker on the map, from the same source, because it
 * is the one mark that means "a place I went". A button whose icon is a tick
 * and whose result is a red pin makes you learn two symbols for one idea.
 *
 * The markup comes from a string builder shared with the DOM marker rather
 * than being re-authored as JSX — two hand-maintained copies of the same
 * artwork drift, and this one has gradients and a highlight to drift in.
 */
export default function PinGlyph({
  size = 16,
  className,
}: {
  size?: number
  className?: string
}) {
  // Gradient ids are document-wide in SVG, so each instance needs its own.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')

  return (
    <span
      aria-hidden
      className={className}
      style={{
        // The artwork is 26x44, so height leads and width follows.
        display: 'inline-block',
        height: size,
        width: (size * 26) / 44,
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{ __html: visitPinSvg(uid) }}
    />
  )
}
