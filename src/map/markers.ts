/**
 * Hand-drawn map markers.
 *
 * These are DOM elements rather than MapLibre symbol layers on purpose. A
 * symbol layer needs a raster sprite, which means either shipping PNGs at
 * three densities or rasterising at runtime — and neither can animate. These
 * are inline SVG and CSS, so they stay sharp at any zoom, cost no requests,
 * and the location dot can actually pulse.
 */

/**
 * The pin drawing itself, as markup.
 *
 * Shared rather than duplicated because this shape is now the brand mark for
 * "Been here": it is the marker on the map *and* the icon on the button that
 * creates one. Those two drifting apart is exactly the kind of small
 * inconsistency that makes an interface feel assembled rather than designed.
 *
 * `uid` must differ per instance on a page. SVG resolves url(#id) document-wide,
 * so a shared id would make every pin after the first pick up the first one's
 * gradients.
 */
export function visitPinSvg(uid: string): string {
  return `
<svg viewBox="0 0 26 44" width="100%" height="100%" aria-hidden="true"
     style="display:block;overflow:visible">
  <defs>
    <linearGradient id="n${uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#7c8794"/>
      <stop offset="35%"  stop-color="#e8edf2"/>
      <stop offset="60%"  stop-color="#aab4c0"/>
      <stop offset="100%" stop-color="#68727e"/>
    </linearGradient>
    <radialGradient id="h${uid}" cx="33%" cy="28%" r="78%">
      <stop offset="0%"   stop-color="#ff7d6b"/>
      <stop offset="45%"  stop-color="#f5261a"/>
      <stop offset="100%" stop-color="#ad1109"/>
    </radialGradient>
    <linearGradient id="g${uid}" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- needle: wide where it leaves the head, a point at the coordinate -->
  <path d="M11.3 19 L13 43.4 L14.7 19 Z" fill="url(#n${uid})"/>

  <!-- head -->
  <circle cx="13" cy="12.6" r="10.1" fill="url(#h${uid})"/>
  <!-- the specular highlight that makes it read as a sphere, not a disc -->
  <ellipse cx="9.4" cy="7.9" rx="4.1" ry="2.7"
           transform="rotate(-38 9.4 7.9)" fill="url(#g${uid})"/>
</svg>`
}

/**
 * A visited place, as a map marker.
 *
 * A physical push-pin stuck into the map: a glossy red head over a tapered
 * steel needle whose point is the coordinate. That physicality is the whole
 * idea — the board is a map you have pinned things to, and a pin says "I put
 * this here" in a way a flat circle does not.
 *
 * Anchored at the bottom by the caller so the point, not the centre, lands on
 * the location.
 */
export function visitPinElement(label = 'A place you have been'): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.setAttribute('aria-label', label)
  el.className =
    'block h-[42px] w-[26px] origin-bottom cursor-pointer border-0 bg-transparent p-0 ' +
    'transition-transform duration-150 hover:scale-110'
  // A soft shadow cast by the whole pin. Doing it as a filter rather than a
  // drawn ellipse means it follows the silhouette, including the needle.
  el.style.filter = 'drop-shadow(0 2px 2px rgba(0,0,0,0.28))'
  el.innerHTML = visitPinSvg(Math.random().toString(36).slice(2, 8))
  return el
}


/**
 * Where you are.
 *
 * Two rings leaving a blue dot, offset half a cycle apart, the way Google
 * Maps does it. The animation is not decoration: a still dot is
 * indistinguishable from a stale one, and the pulse is what says the fix is
 * live and the app is still listening.
 *
 * Returns the outer element; the caller owns its position.
 */
export function locationPuckElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'relative flex h-5 w-5 items-center justify-center'

  for (const delay of ['0ms', '1200ms']) {
    const ring = document.createElement('span')
    // Sized by inset rather than by width, so it stays concentric with the dot.
    // An absolutely-positioned child with no inset falls at its static position
    // — which, inside this flex row, is off to one side of the dot rather than
    // around it.
    ring.className =
      'pointer-events-none absolute -inset-2 rounded-full bg-blue-500/40 animate-locate-ping'
    ring.style.animationDelay = delay
    el.appendChild(ring)
  }

  const dot = document.createElement('span')
  dot.className =
    'relative h-4 w-4 rounded-full border-[2.5px] border-white bg-blue-600 ' +
    'shadow-[0_1px_4px_rgba(0,0,0,0.35)] animate-locate-breathe'
  el.appendChild(dot)

  return el
}

/**
 * Turn off the pulse for anyone who has asked the system for less motion.
 *
 * A ring expanding twice a second, forever, in the corner of the eye is
 * exactly the kind of thing that setting exists for. The dot stays.
 */
export function respectReducedMotion(el: HTMLElement): void {
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  for (const node of el.querySelectorAll<HTMLElement>('[class*="animate-locate"]')) {
    node.style.animation = 'none'
    if (node.classList.contains('animate-locate-ping')) node.style.display = 'none'
  }
}
