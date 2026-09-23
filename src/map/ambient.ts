import type maplibregl from 'maplibre-gl'
import {
  type Sprite,
  birdSprite,
  boatSprite,
  carriageSprite,
  cloudShadowSprite,
  cloudSprite,
  kiteSprite,
  lanternSprite,
  leafSprite,
  planeSprite,
  snowflakeSprite,
  splashSprite,
} from './sprites'

/**
 * Ambient life on the map.
 *
 * Everything draws onto one canvas in a single animation frame. A few dozen
 * animated `<div>`s forces a re-layout every frame and drops a mid-range
 * Android to single-digit FPS; one canvas costs a single composite however
 * many sprites are on it.
 *
 * **What makes this read as alive rather than as moving clip-art** is not the
 * artwork — it is that nothing moves in a straight line at a constant speed:
 *
 *   parallax   Clouds sit in three depth bands. Near ones are large, fast and
 *              opaque; far ones small, slow and pale. Nothing communicates
 *              depth as cheaply as things at different distances moving at
 *              different rates.
 *   drift      Every cloud and flake carries its own sine phase, so the
 *              population never falls into step.
 *   banking    Birds roll into their turns, and their wingbeat is eased at the
 *              extremes the way a real one lingers at the top and bottom.
 *   wake       Boats keep a trail of past positions that fades, and bob on a
 *              swell perpendicular to their heading.
 *   carriages  A train is an engine plus carriages spaced behind it along the
 *              same track — so it bends through curves instead of sliding.
 *
 * Two coordinate systems share the loop. Clouds, birds and weather live in
 * screen space and do not move when you pan — a cloud is not at a map
 * coordinate. Trains and boats are world-space, projected each frame, so they
 * pan and zoom with the city.
 */

export interface AmbientConfig {
  clouds: boolean
  birds: boolean
  boats: boolean
  trains: boolean
  kites: boolean
  planes: boolean
  weather: 'rain' | 'snow' | 'autumn' | 'festival' | null
}

export const AMBIENT_OFF: AmbientConfig = {
  clouds: false,
  birds: false,
  boats: false,
  trains: false,
  kites: false,
  planes: false,
  weather: null,
}

type Pt = [number, number]

/**
 * Hand-drawn sea lanes: offshore, the harbour approach, and Thane Creek.
 *
 * Plausible water, not real traffic lanes — no public dataset of Mumbai's
 * shipping routes exists that we can ship. They exist so boats are on water
 * rather than driving through Dadar.
 */
const SEA_LANES: Pt[][] = [
  [
    [72.752, 18.87],
    [72.758, 18.98],
    [72.768, 19.09],
    [72.781, 19.18],
    [72.797, 19.26],
  ],
  [
    [72.79, 18.89],
    [72.85, 18.915],
    [72.91, 18.945],
    [72.955, 18.985],
    [72.975, 19.03],
  ],
  [
    [72.985, 19.05],
    [72.997, 19.11],
    [73.005, 19.17],
    [73.012, 19.22],
  ],
]

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const TAU = Math.PI * 2

interface Cloud {
  x: number
  y: number
  /** 0 = far, 1 = near. Drives size, speed, opacity and shadow. */
  depth: number
  speed: number
  bob: number
  phase: number
  sprite: Sprite
}

interface Bird {
  x: number
  y: number
  vx: number
  vy: number
  flap: number
  flapRate: number
  scale: number
  /** Which flock it belongs to, so it steers with its neighbours. */
  flock: number
}

interface Drop {
  x: number
  y: number
  vy: number
  len: number
  depth: number
}

interface Flake {
  x: number
  y: number
  vy: number
  drift: number
  phase: number
  size: number
  spin: number
  angle: number
  sprite: Sprite | null
  /** Leaves turn edge-on as they fall; snowflakes do not. */
  tumble: boolean
}

interface Kite {
  x: number
  y: number
  vx: number
  /** 0 = far and small, 1 = close and fast. */
  depth: number
  phase: number
  bob: number
  sprite: Sprite
}

interface Plane {
  x: number
  y: number
  vx: number
  vy: number
  scale: number
  /** Screen positions behind it, thinning into a contrail. */
  trail: { x: number; y: number }[]
}

interface Lantern {
  x: number
  y: number
  vy: number
  drift: number
  phase: number
  scale: number
  /** Fades in on release and out again near the top. */
  life: number
  sprite: Sprite
}

interface Splash {
  x: number
  y: number
  life: number
}

interface Traveller {
  path: Pt[]
  t: number
  speed: number
  forward: boolean
  /** Screen positions behind it, for a boat's wake. */
  trail: { x: number; y: number }[]
  /** Pre-rendered carriages, engine first. Empty for boats. */
  cars: Sprite[]
  bob: number
}

/** Point at fraction `t` along a polyline. */
function along(path: Pt[], t: number): Pt {
  if (path.length < 2) return path[0] ?? [0, 0]
  const span = (path.length - 1) * Math.min(Math.max(t, 0), 0.99999)
  const i = Math.floor(span)
  const f = span - i
  const a = path[i]
  const b = path[i + 1] ?? path[i]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

export interface AmbientHandle {
  setConfig(config: AmbientConfig): void
  setRailLines(lines: { coords: Pt[]; colour: string | null }[]): void
  destroy(): void
}

export function createAmbient(
  canvas: HTMLCanvasElement,
  map: maplibregl.Map
): AmbientHandle {
  const ctx = canvas.getContext('2d')
  let config: AmbientConfig = { ...AMBIENT_OFF }
  let frame = 0
  let running = true

  // --- pre-rendered artwork, built once ---
  const cloudSprites = [0, 1, 2, 3, 4].map((i) => cloudSprite(i + 1))
  const cloudShadow = cloudShadowSprite()
  const BIRD_FRAMES = 10
  const birdFrames = Array.from({ length: BIRD_FRAMES }, (_, i) =>
    birdSprite(i / BIRD_FRAMES)
  )
  const boat = boatSprite()
  const splash = splashSprite()
  const leaves = ['#c2410c', '#b45309', '#a16207', '#9a3412', '#ca8a04'].map(leafSprite)
  // Two grades of flake: crisp ones near, formless glows far. That contrast is
  // what makes snow look deep rather than like a texture laid over the screen.
  const flakeNear = snowflakeSprite(true)
  const flakeFar = snowflakeSprite(false)
  // Patang colours off a Mumbai terrace in January — each kite gets two, so
  // the fold down its spine shows.
  const kiteSprites = [
    ['#e11d48', '#fb7185'],
    ['#f59e0b', '#fcd34d'],
    ['#0891b2', '#67e8f9'],
    ['#7c3aed', '#c4b5fd'],
    ['#16a34a', '#86efac'],
    ['#db2777', '#f9a8d4'],
  ].map(([a, b]) => kiteSprite(a, b))
  const plane = planeSprite()
  const lanternSprites = ['#f97316', '#ef4444', '#f59e0b', '#fb7185'].map(lanternSprite)
  const carriageCache = new Map<string, Sprite[]>()

  function carriagesFor(colour: string): Sprite[] {
    let cars = carriageCache.get(colour)
    if (!cars) {
      cars = [carriageSprite(colour, true), carriageSprite(colour, false)]
      carriageCache.set(colour, cars)
    }
    return cars
  }

  let clouds: Cloud[] = []
  let birds: Bird[] = []
  let drops: Drop[] = []
  let flakes: Flake[] = []
  let splashes: Splash[] = []
  let kites: Kite[] = []
  let planes: Plane[] = []
  let lanterns: Lantern[] = []
  let boats: Traveller[] = []
  let trains: Traveller[] = []
  let rails: { coords: Pt[]; colour: string | null }[] = []

  /** Countdown to the next lightning flash, and how bright the current one is. */
  let nextFlash = rand(4, 12)
  let flash = 0

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function viewport() {
    const r = map.getContainer().getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  function size() {
    const { w, h } = viewport()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.max(1, Math.floor(h * dpr))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function seedClouds() {
    const { w, h } = viewport()
    clouds = Array.from({ length: 9 }, (_, i) => {
      // Three depth bands rather than a uniform spread, so the parallax reads
      // as distinct layers instead of mush.
      const depth = [0.25, 0.55, 0.95][i % 3] + rand(-0.08, 0.08)
      return {
        x: rand(-0.3, 1.3) * w,
        y: rand(0.01, 0.42) * h,
        depth,
        speed: 5 + depth * 26,
        bob: rand(3, 9) * depth,
        phase: rand(0, TAU),
        sprite: cloudSprites[i % cloudSprites.length],
      }
    })
  }

  function seedBirds() {
    const { w, h } = viewport()
    birds = []
    // Three small flocks rather than a scatter: birds fly together.
    for (let f = 0; f < 3; f++) {
      const ox = rand(-0.2, 1.1) * w
      const oy = rand(0.08, 0.45) * h
      const heading = rand(-0.25, 0.25)
      const speed = rand(26, 44)
      for (let i = 0; i < 5; i++) {
        birds.push({
          x: ox + rand(-46, 46),
          y: oy + rand(-26, 26),
          vx: Math.cos(heading) * speed,
          vy: Math.sin(heading) * speed,
          flap: rand(0, 1),
          flapRate: rand(2.6, 3.8),
          scale: rand(0.5, 0.95),
          flock: f,
        })
      }
    }
  }

  function seedWeather() {
    const { w, h } = viewport()
    drops = []
    flakes = []
    splashes = []
    if (config.weather === 'rain') {
      drops = Array.from({ length: 220 }, () => {
        const depth = rand(0.35, 1)
        return {
          x: rand(0, w),
          y: rand(-h, h),
          vy: 520 + depth * 780,
          len: 8 + depth * 18,
          depth,
        }
      })
    } else if (config.weather === 'snow') {
      flakes = Array.from({ length: 170 }, () => {
        // One depth value drives size, speed and which sprite it gets, so a
        // flake is consistently near or consistently far — mixing those is
        // what made the old snow read as noise.
        const depth = rand(0.18, 1)
        return {
          x: rand(0, w),
          y: rand(-h, h),
          vy: 16 + depth * 58,
          drift: 10 + depth * 30,
          phase: rand(0, TAU),
          size: 0.16 + depth * 0.42,
          spin: 0,
          angle: 0,
          sprite: depth > 0.72 ? flakeNear : flakeFar,
          tumble: false,
        }
      })
    } else if (config.weather === 'autumn') {
      flakes = Array.from({ length: 55 }, () => ({
        x: rand(0, w),
        y: rand(-h, h),
        vy: rand(36, 82),
        drift: rand(26, 62),
        phase: rand(0, TAU),
        size: rand(0.39, 0.74),
        spin: rand(-2.4, 2.4),
        angle: rand(0, TAU),
        sprite: leaves[Math.floor(rand(0, leaves.length))],
        tumble: true,
      }))
    }

    lanterns = []
    if (config.weather === 'festival') {
      lanterns = Array.from({ length: 26 }, () => {
        const depth = rand(0.25, 1)
        return {
          x: rand(0, w),
          y: rand(0, h * 1.4),
          vy: 10 + depth * 26,
          drift: rand(6, 20),
          phase: rand(0, TAU),
          scale: 0.45 + depth * 0.75,
          life: rand(0.2, 1),
          sprite: lanternSprites[Math.floor(rand(0, lanternSprites.length))],
        }
      })
    }
  }

  function seedKites() {
    const { w, h } = viewport()
    kites = Array.from({ length: 7 }, (_, i) => {
      const depth = [0.35, 0.65, 1][i % 3] + rand(-0.1, 0.1)
      return {
        x: rand(-0.2, 1.2) * w,
        // Kites live in the upper half: they are being flown from roofs below.
        y: rand(0.04, 0.4) * h,
        vx: (Math.random() > 0.5 ? 1 : -1) * (7 + depth * 16),
        depth,
        phase: rand(0, TAU),
        bob: rand(8, 20) * depth,
        sprite: kiteSprites[i % kiteSprites.length],
      }
    })
  }

  function seedPlanes() {
    const { w, h } = viewport()
    planes = Array.from({ length: 2 }, () => {
      const east = Math.random() > 0.5
      return {
        x: east ? -120 : w + 120,
        y: rand(0.08, 0.5) * h,
        vx: (east ? 1 : -1) * rand(26, 40),
        vy: rand(-4, 4),
        scale: rand(0.5, 0.78),
        trail: [],
      }
    })
  }

  function seedBoats() {
    boats = SEA_LANES.flatMap((path) =>
      Array.from({ length: 2 }, () => ({
        path,
        t: Math.random(),
        speed: rand(0.005, 0.011),
        forward: Math.random() > 0.5,
        trail: [],
        cars: [],
        bob: rand(0, TAU),
      }))
    )
  }

  function seedTrains() {
    if (!rails.length) {
      trains = []
      return
    }
    const usable = rails.filter((r) => r.coords.length >= 14)
    const pool = usable.length ? usable : rails
    trains = Array.from({ length: Math.min(9, pool.length) }, (_, i) => {
      const line = pool[(i * 7 + 3) % pool.length]
      const colour = line.colour ?? '#e11d48'
      return {
        path: line.coords,
        t: Math.random(),
        speed: rand(0.008, 0.017),
        forward: Math.random() > 0.5,
        trail: [],
        cars: carriagesFor(colour),
        bob: 0,
      }
    })
  }

  function seedAll() {
    seedClouds()
    seedBirds()
    seedKites()
    seedPlanes()
    seedWeather()
    seedBoats()
    seedTrains()
  }

  // --- drawing ------------------------------------------------------------

  function drawClouds(dt: number, time: number) {
    if (!ctx) return
    const { w } = viewport()
    // Far ones first, so near clouds overlap them.
    for (const c of [...clouds].sort((a, b) => a.depth - b.depth)) {
      c.x += c.speed * dt
      const y = c.y + Math.sin(time * 0.35 + c.phase) * c.bob
      const scale = 0.32 + c.depth * 0.78
      const cw = c.sprite.width * scale
      const ch = c.sprite.height * scale
      if (c.x - cw > w) c.x = -cw

      // The shadow lands below and lags slightly, as if the sun is high and
      // a little behind. It is what puts the cloud above the city.
      ctx.save()
      ctx.globalAlpha = 0.5 * c.depth
      ctx.drawImage(
        cloudShadow,
        c.x - cw / 2 + 18 * c.depth,
        y + ch * 0.75,
        cw * 0.9,
        ch * 0.5
      )
      ctx.restore()

      ctx.save()
      ctx.globalAlpha = 0.45 + c.depth * 0.5
      ctx.drawImage(c.sprite, c.x - cw / 2, y - ch / 2, cw, ch)
      ctx.restore()
    }
  }

  function drawBirds(dt: number) {
    if (!ctx) return
    const { w, h } = viewport()

    // Flock centres, for a gentle cohesion pull.
    const centres = new Map<number, { x: number; y: number; n: number }>()
    for (const b of birds) {
      const c = centres.get(b.flock) ?? { x: 0, y: 0, n: 0 }
      c.x += b.x
      c.y += b.y
      c.n++
      centres.set(b.flock, c)
    }

    for (const b of birds) {
      const c = centres.get(b.flock)!
      const cx = c.x / c.n
      const cy = c.y / c.n

      // Cohesion only — full boids would be more code for a difference nobody
      // would notice at this scale.
      b.vx += (cx - b.x) * 0.12 * dt
      b.vy += (cy - b.y) * 0.12 * dt
      b.vy += Math.sin(b.x * 0.01) * 4 * dt

      const speed = Math.hypot(b.vx, b.vy)
      if (speed > 0) {
        const target = 34
        b.vx = (b.vx / speed) * target
        b.vy = (b.vy / speed) * target
      }

      b.x += b.vx * dt
      b.y += b.vy * dt
      // Faster wings when climbing, which is what birds actually do.
      b.flap = (b.flap + (b.flapRate + Math.max(0, -b.vy) * 0.03) * dt) % 1

      if (b.x > w + 60) b.x = -60
      if (b.x < -60) b.x = w + 60
      if (b.y < -40) b.y = h * 0.5
      if (b.y > h * 0.7) b.y = -30

      const sprite = birdFrames[Math.floor(b.flap * BIRD_FRAMES) % BIRD_FRAMES]
      const sw = sprite.width * b.scale * 0.55
      const sh = sprite.height * b.scale * 0.55

      ctx.save()
      ctx.translate(b.x, b.y)
      // Bank into the turn: roll proportional to vertical velocity.
      ctx.rotate(Math.atan2(b.vy, Math.abs(b.vx)) * 0.5)
      ctx.globalAlpha = 0.55 + b.scale * 0.4
      ctx.drawImage(sprite, -sw / 2, -sh / 2, sw, sh)
      ctx.restore()
    }
  }

  function drawRain(dt: number, time: number) {
    if (!ctx) return
    const { w, h } = viewport()
    /*
     * The wind is not constant. Two sine waves at unrelated periods give a
     * slant that wanders and occasionally gusts hard, which is most of the
     * difference between "rain" and "diagonal lines" — steady rain at a fixed
     * angle reads as a screen effect, because real rain never does that.
     */
    const slant =
      -0.26 + Math.sin(time * 0.21) * 0.16 + Math.sin(time * 0.67) * 0.06

    ctx.save()
    ctx.lineCap = 'round'
    for (const d of drops) {
      d.y += d.vy * dt
      d.x += d.vy * slant * dt
      if (d.y > h) {
        // A landing drop leaves a ring; that is what makes rain feel like it
        // is hitting something rather than passing in front of a picture.
        if (Math.random() < 0.28 && splashes.length < 60) {
          splashes.push({ x: d.x, y: h - rand(0, h * 0.25), life: 1 })
        }
        d.y = -20
        d.x = rand(-40, w + 40)
      }
      if (d.x < -50) d.x = w + 50

      ctx.globalAlpha = 0.18 + d.depth * 0.42
      ctx.strokeStyle = '#bfdbfe'
      ctx.lineWidth = 0.6 + d.depth * 1.1
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x - d.len * slant, d.y - d.len)
      ctx.stroke()
    }
    ctx.restore()

    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]
      s.life -= dt * 2.6
      if (s.life <= 0) {
        splashes.splice(i, 1)
        continue
      }
      const grow = (1 - s.life) * 18 + 4
      ctx.save()
      ctx.globalAlpha = s.life * 0.5
      ctx.drawImage(splash, s.x - grow / 2, s.y - grow / 5, grow, grow / 2.4)
      ctx.restore()
    }
  }

  function drawFlakes(dt: number, time: number) {
    if (!ctx) return
    const { w, h } = viewport()
    for (const f of flakes) {
      f.y += f.vy * dt
      // Flutter, not fall: the horizontal drift is a sine, so each flake
      // swings rather than sliding diagonally.
      f.x += Math.sin(time * 0.8 + f.phase) * f.drift * dt
      f.angle += f.spin * dt

      if (f.y > h + 30) {
        f.y = -30
        f.x = rand(0, w)
      }
      if (f.x < -30) f.x = w + 30
      if (f.x > w + 30) f.x = -30

      if (!f.sprite) continue
      const sw = f.sprite.width * f.size
      ctx.save()
      ctx.translate(f.x, f.y)
      if (f.tumble) {
        ctx.rotate(f.angle)
        // Squash across the tumble axis, so a flat leaf turns edge-on.
        ctx.scale(1, Math.abs(Math.cos(f.angle * 1.7)) * 0.75 + 0.25)
        ctx.globalAlpha = 0.85
      } else {
        // Snow does not tumble, it drifts. Alpha carries the depth instead:
        // the far flakes are nearly transparent, which is what puts distance
        // between the layers.
        ctx.globalAlpha = 0.25 + f.size * 1.2
      }
      ctx.drawImage(f.sprite, -sw / 2, -sw / 2, sw, sw)
      ctx.restore()
    }
  }

  /**
   * Kites, which is the effect that makes this Mumbai rather than anywhere.
   *
   * They drift on the wind rather than flying a course, so the horizontal
   * speed is constant and everything else is oscillation: a slow bob, a slower
   * sway, and a bank angle derived from that sway rather than set separately —
   * a kite tips into the direction it is sliding, and deriving the tilt from
   * the motion is what keeps the two from looking unrelated.
   */
  function drawKites(dt: number, time: number) {
    if (!ctx) return
    const { w, h } = viewport()

    for (const k of kites) {
      k.x += k.vx * dt
      if (k.vx > 0 && k.x > w + 90) k.x = -90
      if (k.vx < 0 && k.x < -90) k.x = w + 90

      const sway = Math.sin(time * 0.7 + k.phase)
      const swayRate = Math.cos(time * 0.7 + k.phase) * 0.7
      const y = k.y + sway * k.bob + Math.sin(time * 1.9 + k.phase) * 2.5
      // Banking into the slide, capped so it never lies flat.
      const tilt = Math.max(-0.5, Math.min(0.5, swayRate * 0.45 + k.vx * 0.006))

      const scale = 0.3 + k.depth * 0.42
      const sw = k.sprite.width * scale
      const sh = k.sprite.height * scale

      ctx.save()
      ctx.translate(k.x, Math.min(y, h * 0.75))
      ctx.rotate(tilt)
      ctx.globalAlpha = 0.5 + k.depth * 0.45
      // Anchored near the nose, because that is where the string pulls and so
      // that is what the whole thing should swing around.
      ctx.drawImage(k.sprite, -sw / 2, -sh * 0.12, sw, sh)
      ctx.restore()
    }
  }

  /**
   * An airliner with a contrail.
   *
   * The trail is the point — a plane alone is a dot you never notice, while a
   * line slowly drawing itself across the sky is the kind of thing you catch
   * out of the corner of your eye. It is stored as screen positions and faded
   * along its length, oldest and faintest at the tail.
   */
  function drawPlanes(dt: number, time: number) {
    if (!ctx) return
    const { w, h } = viewport()

    for (const p of planes) {
      p.x += p.vx * dt
      p.y += p.vy * dt + Math.sin(time * 0.3) * 0.05

      if (p.x > w + 200 || p.x < -200) {
        // Re-enter from the other side at a fresh altitude, so the same two
        // planes never retrace the same line.
        const east = p.vx > 0
        p.x = east ? -160 : w + 160
        p.y = rand(0.08, 0.5) * h
        p.trail = []
      }

      p.trail.push({ x: p.x, y: p.y })
      if (p.trail.length > 90) p.trail.shift()

      if (p.trail.length > 2) {
        ctx.save()
        ctx.lineCap = 'round'
        for (let i = 1; i < p.trail.length; i++) {
          const t = i / p.trail.length
          ctx.globalAlpha = t * 0.22
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1 + t * 2.4
          ctx.beginPath()
          ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y)
          ctx.lineTo(p.trail[i].x, p.trail[i].y)
          ctx.stroke()
        }
        ctx.restore()
      }

      const sw = plane.width * p.scale
      const sh = plane.height * p.scale
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(Math.atan2(p.vy, p.vx))
      ctx.globalAlpha = 0.8
      ctx.drawImage(plane, -sw / 2, -sh / 2, sw, sh)
      ctx.restore()
    }
  }

  /**
   * Released lanterns, for the festival theme.
   *
   * They rise, which is the one thing nothing else on this canvas does —
   * clouds, kites and planes all travel sideways and rain falls. Motion in an
   * unused direction is what makes the theme feel like a different night
   * rather than a recoloured one.
   */
  function drawLanterns(dt: number, time: number) {
    if (!ctx) return
    const { w, h } = viewport()

    for (const l of lanterns) {
      l.y -= l.vy * dt
      l.x += Math.sin(time * 0.45 + l.phase) * l.drift * dt

      if (l.y < -60) {
        l.y = h + rand(20, 160)
        l.x = rand(0, w)
        l.life = 0
      }
      // Fade in on release, and out again as it climbs out of sight.
      l.life = Math.min(1, l.life + dt * 0.6)
      const height = 1 - Math.max(0, Math.min(1, (h - l.y) / h))
      const fade = l.life * (0.35 + height * 0.65)

      const sw = l.sprite.width * l.scale
      const sh = l.sprite.height * l.scale
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = fade * 0.9
      ctx.translate(l.x, l.y)
      ctx.rotate(Math.sin(time * 0.9 + l.phase) * 0.12)
      ctx.drawImage(l.sprite, -sw / 2, -sh / 2, sw, sh)
      ctx.restore()
    }
  }

  /**
   * The air itself.
   *
   * A CSS filter on the map shifts colour but cannot add anything — and weather
   * is mostly things being *added* between you and the ground: haze, gloom at
   * the edges, the sudden flat light of a lightning flash. So the canvas paints
   * an atmosphere over the map and under the sky.
   *
   * It sits above trains and boats (which are on the ground, seen through the
   * weather) and below clouds and precipitation (which are in it).
   */
  function drawAtmosphere(kind: NonNullable<AmbientConfig['weather']>) {
    if (!ctx) return
    const { w, h } = viewport()

    /*
     * Much lighter than it was. The old wash sat at 40% opacity across the
     * whole screen, which did not read as weather so much as a coloured sheet
     * of glass — street names went grey, parks went blue, and the map stopped
     * being worth looking at. The light level is now handled by an achromatic
     * filter on the map canvas itself (see index.css); this only adds the
     * colour of the air, and it clears towards the ground so labels stay
     * legible where you are actually reading them.
     */
    const g = ctx.createLinearGradient(0, 0, 0, h)
    if (kind === 'rain') {
      g.addColorStop(0, 'rgba(22,38,68,0.34)')
      g.addColorStop(0.5, 'rgba(28,48,82,0.16)')
      g.addColorStop(1, 'rgba(34,56,92,0.05)')
    } else if (kind === 'snow') {
      g.addColorStop(0, 'rgba(216,234,250,0.36)')
      g.addColorStop(0.55, 'rgba(232,244,253,0.17)')
      g.addColorStop(1, 'rgba(244,250,255,0.05)')
    } else if (kind === 'festival') {
      // Warm from below, as a lit street is: the glow comes off the ground.
      g.addColorStop(0, 'rgba(30,16,52,0.26)')
      g.addColorStop(0.55, 'rgba(90,40,60,0.12)')
      g.addColorStop(1, 'rgba(255,150,60,0.14)')
    } else {
      g.addColorStop(0, 'rgba(184,116,44,0.16)')
      g.addColorStop(1, 'rgba(184,116,44,0.03)')
    }
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  /** Darkened or brightened edges, drawn last so it frames everything. */
  function drawVignette(kind: NonNullable<AmbientConfig['weather']>) {
    if (!ctx) return
    const { w, h } = viewport()
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.32,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.78
    )
    if (kind === 'rain') {
      g.addColorStop(0, 'rgba(10,20,40,0)')
      g.addColorStop(1, 'rgba(8,16,34,0.42)')
    } else if (kind === 'snow') {
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(1, 'rgba(208,228,246,0.38)')
    } else if (kind === 'festival') {
      g.addColorStop(0, 'rgba(20,8,40,0)')
      g.addColorStop(1, 'rgba(24,10,44,0.42)')
    } else {
      g.addColorStop(0, 'rgba(120,70,20,0)')
      g.addColorStop(1, 'rgba(110,64,18,0.26)')
    }
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  /**
   * Distant lightning, rarely.
   *
   * Two quick pulses rather than one, because real lightning almost always
   * flickers — a single clean fade reads as a screen glitch.
   */
  function drawLightning(dt: number) {
    if (!ctx) return
    nextFlash -= dt
    if (nextFlash <= 0) {
      flash = 1
      nextFlash = rand(7, 20)
    }
    if (flash <= 0) return

    flash = Math.max(0, flash - dt * 3.2)
    const flicker = flash > 0.75 ? 1 : flash > 0.62 ? 0.25 : flash
    const { w, h } = viewport()
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = `rgba(186,214,255,${flicker * 0.3})`
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  /** Screen position and heading for a traveller at offset `t`. */
  function projectAt(item: Traveller, t: number) {
    const here = map.project(along(item.path, t))
    const nudge = item.forward ? 0.004 : -0.004
    const next = map.project(along(item.path, Math.min(1, Math.max(0, t + nudge))))
    return {
      x: here.x,
      y: here.y,
      angle: Math.atan2(next.y - here.y, next.x - here.x),
    }
  }

  function drawBoats(dt: number, time: number) {
    if (!ctx) return
    const { w, h } = viewport()
    for (const b of boats) {
      b.t += (b.forward ? 1 : -1) * b.speed * dt
      if (b.t > 1) {
        b.t = 1
        b.forward = false
      }
      if (b.t < 0) {
        b.t = 0
        b.forward = true
      }

      const p = projectAt(b, b.t)
      if (p.x < -120 || p.y < -120 || p.x > w + 120 || p.y > h + 120) {
        b.trail.length = 0
        continue
      }

      // Bob perpendicular to heading, so it rides a swell rather than
      // sliding up and down the screen.
      const swell = Math.sin(time * 1.6 + b.bob) * 1.8
      const px = p.x + Math.cos(p.angle + Math.PI / 2) * swell
      const py = p.y + Math.sin(p.angle + Math.PI / 2) * swell

      b.trail.push({ x: px, y: py })
      if (b.trail.length > 26) b.trail.shift()

      ctx.save()
      ctx.lineCap = 'round'
      for (let i = 1; i < b.trail.length; i++) {
        const fade = i / b.trail.length
        ctx.globalAlpha = fade * 0.3
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = fade * 4.5
        ctx.beginPath()
        ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y)
        ctx.lineTo(b.trail[i].x, b.trail[i].y)
        ctx.stroke()
      }
      ctx.restore()

      const sw = 26
      const sh = (boat.height / boat.width) * sw
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(b.forward ? p.angle : p.angle + Math.PI)
      ctx.drawImage(boat, -sw / 2, -sh / 2, sw, sh)
      ctx.restore()
    }
  }

  function drawTrains(dt: number) {
    if (!ctx) return
    const { w, h } = viewport()
    const CARS = 4
    // Spacing along the path, as a fraction. Scaled by zoom so carriages stay
    // coupled rather than drifting apart as you zoom in.
    const zoom = map.getZoom()
    const gap = 0.004 * Math.pow(2, (13 - zoom) * 0.55)

    for (const tr of trains) {
      tr.t += (tr.forward ? 1 : -1) * tr.speed * dt
      if (tr.t > 1) {
        tr.t = 1
        tr.forward = false
      }
      if (tr.t < 0) {
        tr.t = 0
        tr.forward = true
      }

      const lead = projectAt(tr, tr.t)
      if (lead.x < -160 || lead.y < -160 || lead.x > w + 160 || lead.y > h + 160) {
        continue
      }

      const sw = 22
      const sh = (tr.cars[0].height / tr.cars[0].width) * sw

      // Draw back to front so the engine sits on top at a coupling.
      for (let i = CARS - 1; i >= 0; i--) {
        const offset = tr.t - (tr.forward ? 1 : -1) * gap * i
        if (offset < 0 || offset > 1) continue
        const p = projectAt(tr, offset)
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(tr.forward ? p.angle : p.angle + Math.PI)
        ctx.drawImage(tr.cars[i === 0 ? 0 : 1], -sw / 2, -sh / 2, sw, sh)
        ctx.restore()
      }
    }
  }

  // --- loop ---------------------------------------------------------------

  let last = performance.now()

  function tick(now: number) {
    if (!running) return
    frame = requestAnimationFrame(tick)
    if (!ctx) return

    // Clamp: a backgrounded tab resumes with a huge delta and everything
    // teleports across the screen.
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    const time = now / 1000

    const { w, h } = viewport()
    ctx.clearRect(0, 0, w, h)

    /*
     * Layered by where each thing actually is: ground vehicles, then the air
     * they are seen through, then what is flying in it, then what is falling,
     * then the frame.
     */
    if (config.trains) drawTrains(dt)
    if (config.boats) drawBoats(dt, time)
    if (config.weather) drawAtmosphere(config.weather)
    if (config.clouds) drawClouds(dt, time)
    // Planes are above the clouds and below everything else in the air.
    if (config.planes) drawPlanes(dt, time)
    if (config.birds) drawBirds(dt)
    if (config.kites) drawKites(dt, time)
    if (config.weather === 'rain') {
      drawRain(dt, time)
      drawLightning(dt)
    } else if (config.weather === 'festival') {
      drawLanterns(dt, time)
    } else if (config.weather) {
      drawFlakes(dt, time)
    }
    if (config.weather) drawVignette(config.weather)
  }

  size()
  seedAll()
  if (!reduceMotion) frame = requestAnimationFrame(tick)

  const onResize = () => {
    size()
    seedAll()
  }
  map.on('resize', onResize)
  window.addEventListener('resize', onResize)

  const onVisibility = () => {
    if (document.hidden) {
      running = false
      cancelAnimationFrame(frame)
    } else if (!reduceMotion) {
      running = true
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  return {
    setConfig(next) {
      const weatherChanged = next.weather !== config.weather
      config = next
      if (weatherChanged) seedWeather()
    },
    setRailLines(lines) {
      rails = lines
      seedTrains()
    },
    destroy() {
      running = false
      cancelAnimationFrame(frame)
      map.off('resize', onResize)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
