/**
 * Sprites, drawn once into offscreen canvases and then blitted.
 *
 * The first version of this file drew every shape with `ctx.arc` and
 * `ctx.roundRect` on every frame, and it looked exactly like that: hard-edged
 * primitives with no depth. Two things fix it.
 *
 * **Soft edges.** Real clouds have no outline. Radial gradients fading to
 * transparent cost nothing when they are rasterised once at startup, and are
 * the single biggest difference between "circle" and "cloud".
 *
 * **Pre-rendering.** A gradient-filled multi-blob shape is far too expensive to
 * rebuild sixty times a second for a dozen clouds. Drawn once into an offscreen
 * canvas, each one becomes a single `drawImage` — the GPU's cheapest operation.
 *
 * Everything here is deliberately drawn at a generous size and scaled down at
 * blit time, so sprites stay crisp on a 2× display.
 */

export type Sprite = HTMLCanvasElement

function make(w: number, h: number): { c: Sprite; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')!
  return { c, x }
}

/**
 * A cloud: several overlapping soft blobs, brighter on top than underneath.
 *
 * The vertical brightness gradient is what sells it — a flat white blob reads
 * as a sticker, while a cloud lit from above reads as volume.
 */
export function cloudSprite(seed: number): Sprite {
  const W = 320
  const H = 170
  const { c, x } = make(W, H)

  // A small deterministic PRNG, so a given seed always yields the same cloud
  // and they don't all reshape themselves on a resize.
  let s = seed * 9301 + 49297
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }

  const blobs = [
    { cx: 0.5, cy: 0.62, r: 0.3 },
    { cx: 0.33, cy: 0.68, r: 0.22 },
    { cx: 0.68, cy: 0.66, r: 0.24 },
    { cx: 0.44, cy: 0.46, r: 0.24 },
    { cx: 0.6, cy: 0.48, r: 0.2 },
    { cx: 0.24, cy: 0.74, r: 0.16 },
    { cx: 0.78, cy: 0.74, r: 0.15 },
  ]

  x.globalCompositeOperation = 'lighter'
  for (const b of blobs) {
    const cx = (b.cx + (rnd() - 0.5) * 0.06) * W
    const cy = (b.cy + (rnd() - 0.5) * 0.05) * H
    const r = (b.r + (rnd() - 0.5) * 0.04) * W

    const g = x.createRadialGradient(cx, cy - r * 0.25, r * 0.1, cx, cy, r)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.6)')
    g.addColorStop(0.78, 'rgba(244,248,255,0.22)')
    g.addColorStop(1, 'rgba(240,246,255,0)')
    x.fillStyle = g
    x.beginPath()
    x.arc(cx, cy, r, 0, Math.PI * 2)
    x.fill()
  }

  // A faint cool underside, so the cloud has a bottom.
  x.globalCompositeOperation = 'source-atop'
  const shade = x.createLinearGradient(0, H * 0.45, 0, H)
  shade.addColorStop(0, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(176,196,222,0.35)')
  x.fillStyle = shade
  x.fillRect(0, 0, W, H)

  return c
}

/** The soft shadow a cloud casts on the city below. */
export function cloudShadowSprite(): Sprite {
  const W = 320
  const H = 150
  const { c, x } = make(W, H)
  const g = x.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 2)
  g.addColorStop(0, 'rgba(30,41,59,0.17)')
  g.addColorStop(0.6, 'rgba(30,41,59,0.07)')
  g.addColorStop(1, 'rgba(30,41,59,0)')
  x.fillStyle = g
  x.beginPath()
  x.ellipse(W / 2, H / 2, W / 2, H / 2.6, 0, 0, Math.PI * 2)
  x.fill()
  return c
}

/**
 * A bird, at one point in its wing cycle (0 = full down, 1 = full up).
 *
 * Pre-rendering the cycle as frames means the flap costs an array lookup rather
 * than two bezier curves per bird per frame, and lets the wings have real
 * tapering thickness instead of a constant stroke.
 */
export function birdSprite(phase: number): Sprite {
  const W = 64
  const H = 44
  const { c, x } = make(W, H)
  const cx = W / 2
  const cy = H * 0.6

  // Ease the extremes so the wings linger at the top and bottom of the beat,
  // which is what a real wingbeat does and what a raw sine does not.
  const eased = 0.5 - Math.cos(phase * Math.PI * 2) / 2
  const lift = -14 + eased * 26
  const span = 22 - eased * 3

  x.strokeStyle = 'rgba(38,48,64,0.8)'
  x.lineWidth = 2.6
  x.lineCap = 'round'
  x.lineJoin = 'round'

  x.beginPath()
  x.moveTo(cx - span, cy + lift * 0.45)
  x.quadraticCurveTo(cx - span * 0.45, cy + lift, cx, cy)
  x.quadraticCurveTo(cx + span * 0.45, cy + lift, cx + span, cy + lift * 0.45)
  x.stroke()

  // A body, so it isn't just a floating "m".
  x.fillStyle = 'rgba(38,48,64,0.8)'
  x.beginPath()
  x.ellipse(cx, cy + 1, 3.4, 2.2, 0, 0, Math.PI * 2)
  x.fill()

  return c
}

/**
 * A boat, seen from above.
 *
 * The first version of this was drawn in side elevation — a hull with a cabin
 * sitting on top of it, the way you would sketch a boat on paper. On a map
 * that is looking straight down at the city, that is a category error: the
 * boat appeared to be standing on the water like a cardboard cut-out, which is
 * exactly the "weird" everyone noticed without being able to name it.
 *
 * So: plan view. Pointed bow to the right, rounded transom to the left,
 * superstructure set back from centre, and shading that runs across the beam
 * rather than down the side — because from above, the light falls on the deck.
 */
export function boatSprite(): Sprite {
  const W = 88
  const H = 34
  const { c, x } = make(W, H)
  const cy = H / 2

  // --- hull -------------------------------------------------------------
  const hull = () => {
    x.beginPath()
    x.moveTo(84, cy) // bow
    x.quadraticCurveTo(52, cy - 11, 16, cy - 10)
    x.quadraticCurveTo(7, cy - 10, 7, cy - 6) // transom corner
    x.lineTo(7, cy + 6)
    x.quadraticCurveTo(7, cy + 10, 16, cy + 10)
    x.quadraticCurveTo(52, cy + 11, 84, cy)
    x.closePath()
  }

  hull()
  // Across the beam, not down the side: from above, one gunwale catches the
  // light and the other is in its own shadow.
  const shell = x.createLinearGradient(0, cy - 11, 0, cy + 11)
  shell.addColorStop(0, '#ffffff')
  shell.addColorStop(0.42, '#f2f6fa')
  shell.addColorStop(0.62, '#dbe4ee')
  shell.addColorStop(1, '#adbccd')
  x.fillStyle = shell
  x.fill()
  x.strokeStyle = 'rgba(15,23,42,0.45)'
  x.lineWidth = 1.1
  x.stroke()

  // --- open deck: a darker well inside the gunwales ----------------------
  x.save()
  hull()
  x.clip()
  x.fillStyle = 'rgba(71,95,124,0.55)'
  x.beginPath()
  x.roundRect(12, cy - 6.5, 58, 13, 5)
  x.fill()
  x.restore()

  // --- superstructure ----------------------------------------------------
  x.fillStyle = '#e8eef5'
  x.beginPath()
  x.roundRect(22, cy - 5.5, 22, 11, 3)
  x.fill()
  x.strokeStyle = 'rgba(15,23,42,0.35)'
  x.lineWidth = 0.9
  x.stroke()

  // Roof panel, lighter along its spine where it faces straight up.
  const roof = x.createLinearGradient(0, cy - 5.5, 0, cy + 5.5)
  roof.addColorStop(0, 'rgba(255,255,255,0.15)')
  roof.addColorStop(0.45, 'rgba(255,255,255,0.75)')
  roof.addColorStop(1, 'rgba(90,110,135,0.35)')
  x.fillStyle = roof
  x.beginPath()
  x.roundRect(22, cy - 5.5, 22, 11, 3)
  x.fill()

  // Mast, and the foredeck hatch ahead of the cabin.
  x.fillStyle = 'rgba(30,41,59,0.75)'
  x.beginPath()
  x.arc(48, cy, 1.6, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = 'rgba(148,163,184,0.7)'
  x.beginPath()
  x.roundRect(55, cy - 3, 9, 6, 1.5)
  x.fill()

  // A navigation light at the bow, so the front is readable at small sizes.
  x.fillStyle = 'rgba(255,241,186,0.95)'
  x.beginPath()
  x.arc(78, cy, 1.5, 0, Math.PI * 2)
  x.fill()

  return c
}

/**
 * One carriage of a train, seen from above.
 *
 * Same correction as the boat: what used to be here was a side view with
 * windows along it, which from a map's viewpoint made the train look like it
 * was lying on its side. From above you see roof, not windows — so this is a
 * roof: a livery-coloured shell, a lighter crown down the spine where it faces
 * the sky, roof equipment, and dark shadow lines at the ends where the
 * carriages couple.
 */
export function carriageSprite(colour: string, isEngine: boolean): Sprite {
  const W = 64
  const H = 24
  const { c, x } = make(W, H)
  const cy = H / 2
  const top = cy - 7.5
  const bot = cy + 7.5

  // --- shell -------------------------------------------------------------
  const shell = () => {
    x.beginPath()
    if (isEngine) {
      // A cab end tapers; that taper is the only cue at this size that says
      // which way the train is going.
      x.moveTo(60, cy)
      x.quadraticCurveTo(54, top, 46, top)
      x.lineTo(5, top)
      x.quadraticCurveTo(2, top, 2, cy)
      x.quadraticCurveTo(2, bot, 5, bot)
      x.lineTo(46, bot)
      x.quadraticCurveTo(54, bot, 60, cy)
    } else {
      x.roundRect(2, top, W - 6, bot - top, 3)
    }
    x.closePath()
  }

  shell()
  x.fillStyle = colour
  x.fill()

  // Cylindrical crown: bright along the spine, falling away to both sides.
  const crown = x.createLinearGradient(0, top, 0, bot)
  crown.addColorStop(0, 'rgba(0,0,0,0.30)')
  crown.addColorStop(0.3, 'rgba(255,255,255,0.18)')
  crown.addColorStop(0.48, 'rgba(255,255,255,0.52)')
  crown.addColorStop(0.7, 'rgba(255,255,255,0.10)')
  crown.addColorStop(1, 'rgba(0,0,0,0.34)')
  x.fillStyle = crown
  x.fill()

  x.strokeStyle = 'rgba(255,255,255,0.7)'
  x.lineWidth = 1
  x.stroke()

  // --- roof equipment ----------------------------------------------------
  x.save()
  shell()
  x.clip()

  // Ribs across the roof: the strongest "this is a roof" signal there is.
  x.strokeStyle = 'rgba(0,0,0,0.16)'
  x.lineWidth = 1
  for (let i = 0; i < 6; i++) {
    const rx = 9 + i * 8
    x.beginPath()
    x.moveTo(rx, top + 1)
    x.lineTo(rx, bot - 1)
    x.stroke()
  }

  // Ventilator housings down the centre line.
  x.fillStyle = 'rgba(236,244,252,0.85)'
  for (let i = 0; i < 3; i++) {
    x.beginPath()
    x.roundRect(12 + i * 15, cy - 2.6, 9, 5.2, 1.4)
    x.fill()
  }
  x.strokeStyle = 'rgba(0,0,0,0.2)'
  x.lineWidth = 0.7
  for (let i = 0; i < 3; i++) {
    x.beginPath()
    x.roundRect(12 + i * 15, cy - 2.6, 9, 5.2, 1.4)
    x.stroke()
  }

  // The coupling shadow at the blunt end, so a rake reads as separate cars
  // rather than one long worm.
  const gap = x.createLinearGradient(2, 0, 9, 0)
  gap.addColorStop(0, 'rgba(0,0,0,0.45)')
  gap.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = gap
  x.fillRect(2, top, 7, bot - top)
  x.restore()

  if (isEngine) {
    // Headlights on the nose, spread apart the way a cab's are.
    x.fillStyle = 'rgba(255,245,200,0.95)'
    for (const dy of [-3.2, 3.2]) {
      x.beginPath()
      x.ellipse(53, cy + dy, 2.2, 1.6, 0, 0, Math.PI * 2)
      x.fill()
    }
  }

  return c
}

/** An autumn leaf, drawn once per colour and tumbled at blit time. */
export function leafSprite(colour: string): Sprite {
  const W = 28
  const H = 28
  const { c, x } = make(W, H)
  x.translate(W / 2, H / 2)

  x.fillStyle = colour
  x.beginPath()
  // Two mirrored curves meeting at a point: a simple, readable leaf.
  x.moveTo(0, -10)
  x.quadraticCurveTo(9, -3, 0, 10)
  x.quadraticCurveTo(-9, -3, 0, -10)
  x.fill()

  x.strokeStyle = 'rgba(0,0,0,0.22)'
  x.lineWidth = 0.9
  x.beginPath()
  x.moveTo(0, -9)
  x.lineTo(0, 9)
  x.stroke()

  return c
}

/** A ring on the ground where a raindrop landed. */
export function splashSprite(): Sprite {
  const W = 26
  const H = 14
  const { c, x } = make(W, H)
  x.strokeStyle = 'rgba(191,219,254,0.9)'
  x.lineWidth = 1.4
  x.beginPath()
  x.ellipse(W / 2, H / 2, W / 2 - 2, H / 2 - 2, 0, 0, Math.PI * 2)
  x.stroke()
  return c
}

/**
 * A snowflake, as a soft glow with a faint crystal inside it.
 *
 * Flakes used to be flat `ctx.arc` discs, which is why winter looked like
 * static rather than weather. Real snow is out of focus almost all the time —
 * the eye reads depth from how soft each flake is, not from its shape — so the
 * glow does most of the work and the six arms only just show through.
 */
export function snowflakeSprite(detailed: boolean): Sprite {
  const S = 48
  const { c, x } = make(S, S)
  const m = S / 2

  const g = x.createRadialGradient(m, m, 0, m, m, m)
  g.addColorStop(0, 'rgba(255,255,255,0.98)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.72)')
  g.addColorStop(0.7, 'rgba(236,246,255,0.22)')
  g.addColorStop(1, 'rgba(226,240,255,0)')
  x.fillStyle = g
  x.beginPath()
  x.arc(m, m, m, 0, Math.PI * 2)
  x.fill()

  // Only the near flakes get arms. Drawing them on the distant ones would
  // flatten the depth the blur is there to create.
  if (detailed) {
    x.strokeStyle = 'rgba(255,255,255,0.85)'
    x.lineWidth = 1.5
    x.lineCap = 'round'
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      x.beginPath()
      x.moveTo(m, m)
      x.lineTo(m + dx * m * 0.62, m + dy * m * 0.62)
      x.stroke()
      // One pair of barbs per arm is enough to read as a crystal.
      const bx = m + dx * m * 0.4
      const by = m + dy * m * 0.4
      for (const turn of [0.6, -0.6]) {
        x.beginPath()
        x.moveTo(bx, by)
        x.lineTo(
          bx + Math.cos(a + turn) * m * 0.2,
          by + Math.sin(a + turn) * m * 0.2
        )
        x.stroke()
      }
    }
  }

  return c
}

/**
 * A patang — the fighter kite flown off Mumbai terraces.
 *
 * Drawn nose-up with the tail trailing below, and rotated at blit time so it
 * banks as it drifts. Two triangles rather than one flat diamond: a kite in
 * the air is always slightly edge-on, and the fold down the spine is what
 * stops it reading as a playing-card lozenge.
 */
export function kiteSprite(a: string, b: string): Sprite {
  const W = 46
  const H = 108
  const { c, x } = make(W, H)
  const cx = W / 2
  const nose = 6
  const waist = 34
  const tailTip = 62

  // Left half, in shadow.
  x.beginPath()
  x.moveTo(cx, nose)
  x.lineTo(4, waist)
  x.lineTo(cx, tailTip)
  x.closePath()
  x.fillStyle = a
  x.fill()

  // Right half, catching the light.
  x.beginPath()
  x.moveTo(cx, nose)
  x.lineTo(W - 4, waist)
  x.lineTo(cx, tailTip)
  x.closePath()
  x.fillStyle = b
  x.fill()

  // Spine and cross spar.
  x.strokeStyle = 'rgba(0,0,0,0.35)'
  x.lineWidth = 1
  x.beginPath()
  x.moveTo(cx, nose)
  x.lineTo(cx, tailTip)
  x.moveTo(4, waist)
  x.lineTo(W - 4, waist)
  x.stroke()

  x.strokeStyle = 'rgba(0,0,0,0.45)'
  x.lineWidth = 1.2
  x.beginPath()
  x.moveTo(cx, nose)
  x.lineTo(4, waist)
  x.lineTo(cx, tailTip)
  x.lineTo(W - 4, waist)
  x.closePath()
  x.stroke()

  // Tail: a slack line with bows on it, curving off to one side so the kite
  // looks like it is being pulled rather than hanging.
  x.strokeStyle = 'rgba(0,0,0,0.3)'
  x.lineWidth = 1
  x.beginPath()
  x.moveTo(cx, tailTip)
  x.quadraticCurveTo(cx + 12, tailTip + 20, cx + 4, H - 4)
  x.stroke()

  for (let i = 1; i <= 3; i++) {
    const t = i / 4
    const bx = cx + 12 * 2 * t * (1 - t) + 4 * t * t
    const by = tailTip + (H - 4 - tailTip) * t
    x.fillStyle = i % 2 ? b : a
    x.beginPath()
    x.ellipse(bx, by, 3.4, 1.8, Math.PI / 5, 0, Math.PI * 2)
    x.fill()
  }

  return c
}

/**
 * An airliner, seen from above, high enough to be a shape rather than a plane.
 *
 * Kept deliberately small and pale: at cruising height over the city it is a
 * silver splinter, and anything more detailed would compete with the map.
 */
export function planeSprite(): Sprite {
  const W = 54
  const H = 46
  const { c, x } = make(W, H)
  const cy = H / 2

  x.fillStyle = '#eef3f9'
  x.strokeStyle = 'rgba(30,41,59,0.35)'
  x.lineWidth = 0.9

  // Swept wings, root near the middle of the fuselage.
  x.beginPath()
  x.moveTo(30, cy - 1.6)
  x.lineTo(15, cy - 20)
  x.lineTo(21, cy - 20)
  x.lineTo(37, cy - 2)
  x.lineTo(37, cy + 2)
  x.lineTo(21, cy + 20)
  x.lineTo(15, cy + 20)
  x.lineTo(30, cy + 1.6)
  x.closePath()
  x.fill()
  x.stroke()

  // Tailplane.
  x.beginPath()
  x.moveTo(9, cy - 1.2)
  x.lineTo(2, cy - 8)
  x.lineTo(6, cy - 8)
  x.lineTo(14, cy - 1)
  x.lineTo(14, cy + 1)
  x.lineTo(6, cy + 8)
  x.lineTo(2, cy + 8)
  x.lineTo(9, cy + 1.2)
  x.closePath()
  x.fill()
  x.stroke()

  // Fuselage last, so it sits over both wing roots.
  x.beginPath()
  x.moveTo(50, cy)
  x.quadraticCurveTo(44, cy - 3.4, 20, cy - 3.2)
  x.lineTo(4, cy - 2)
  x.quadraticCurveTo(1, cy, 4, cy + 2)
  x.lineTo(20, cy + 3.2)
  x.quadraticCurveTo(44, cy + 3.4, 50, cy)
  x.closePath()
  const body = x.createLinearGradient(0, cy - 3.4, 0, cy + 3.4)
  body.addColorStop(0, '#ffffff')
  body.addColorStop(0.5, '#e7eef6')
  body.addColorStop(1, '#b9c6d6')
  x.fillStyle = body
  x.fill()
  x.stroke()

  return c
}

/**
 * A paper lantern, for the festival theme.
 *
 * Lit from inside rather than shaded from outside — the glow *is* the object,
 * so the gradient runs from a hot core out to a warm halo that bleeds past the
 * paper.
 */
export function lanternSprite(hue: string): Sprite {
  const W = 40
  const H = 56
  const { c, x } = make(W, H)
  const cx = W / 2
  const cy = 26

  // Halo first, underneath everything.
  const halo = x.createRadialGradient(cx, cy, 2, cx, cy, 20)
  halo.addColorStop(0, 'rgba(255,214,140,0.55)')
  halo.addColorStop(1, 'rgba(255,190,90,0)')
  x.fillStyle = halo
  x.beginPath()
  x.arc(cx, cy, 20, 0, Math.PI * 2)
  x.fill()

  // Paper body.
  x.beginPath()
  x.ellipse(cx, cy, 8.5, 12, 0, 0, Math.PI * 2)
  const paper = x.createRadialGradient(cx - 2, cy - 4, 1, cx, cy, 13)
  paper.addColorStop(0, '#fff3cf')
  paper.addColorStop(0.55, hue)
  paper.addColorStop(1, 'rgba(120,30,10,0.9)')
  x.fillStyle = paper
  x.fill()

  // Caps and the flame inside.
  x.fillStyle = 'rgba(80,32,12,0.85)'
  x.beginPath()
  x.roundRect(cx - 4, cy - 14.5, 8, 3.5, 1.4)
  x.fill()
  x.beginPath()
  x.roundRect(cx - 3.5, cy + 11.5, 7, 3, 1.2)
  x.fill()

  x.fillStyle = 'rgba(255,241,190,0.95)'
  x.beginPath()
  x.ellipse(cx, cy + 2, 2.2, 3.4, 0, 0, Math.PI * 2)
  x.fill()

  return c
}
